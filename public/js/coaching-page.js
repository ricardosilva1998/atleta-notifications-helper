// The coaching booking page (views/coaching.ejs, routes/coaching.js). It draws the strip of days, the free times of the
// chosen day for the chosen length, the viewer's panel (join first, the note and "Request this time", the limit) and
// "Your bookings" from window.COACHING_DATA.state, and again from each answer of GET /coaching/<login>/state. Times
// arrive as UTC instants and are shown in the viewer's own time zone, grouped by the viewer's own days
// (window.COACHING_CORE, public/js/coaching-core.js). Texts come from window.COACHING_TEXTS, with their {{fields}}
// filled here in one pass; every text, name and note goes in with textContent. public/js/csrf.js adds the session's
// token to the POSTs.
(function () {
  'use strict';

  var DATA = window.COACHING_DATA || {};
  var T = window.COACHING_TEXTS || {};
  var C = window.COACHING_CORE;
  if (!C || !DATA.state) return;

  var REQUEST_MS = 20000;
  var STALE_MS = 60000;
  var lang = DATA.lang || 'en';
  var base = '/coaching/' + encodeURIComponent(DATA.login);
  var zone = 'UTC';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    new Intl.DateTimeFormat('en', { timeZone: zone }); // a zone this browser cannot format with counts as UTC
  } catch (e) { zone = 'UTC'; }

  var state = DATA.state;
  // 1 h first, as the mockup; 30 min when only half-hour times are free.
  var minutes = state.slots && state.slots[60] && !state.slots[60].length && state.slots[30] && state.slots[30].length ? 30 : 60;
  var day = null; // the chosen day (YYYY-MM-DD in the viewer's zone)
  var pick = null; // the chosen start (UTC ms)
  var busy = false;
  var asked = !state.viewer; // whether /state has answered (the membership comes only from there)
  var lastRead = Date.now();

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
  function serverName() { return state.guildName || T.serverFallback; }
  function fields() { return { name: DATA.name, zone: zone, server: serverName(), max: state.maxUpcoming }; }
  function lengthText(m) { return m === 30 ? T.minutes30 : T.minutes60; }
  function time(ms) { return C.timeLabel(ms, zone, lang); }

  // ── Requests ──
  // { ok: true, data } or { ok: false, code, text }: the route's own text for a refusal (the CSRF check's too); a
  // redirect or an answer that is not JSON did not work; no answer in 20 s counts as no network.
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
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return { ok: false, text: T.failed };
      return res.json().then(function (json) {
        if (res.ok && json && json.ok !== false) return { ok: true, data: json };
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

  // recheck: "I've joined" asks the server to ask Discord again rather than read its kept answer.
  function refresh(recheck) {
    return api('GET', base + '/state' + (recheck ? '?recheck=1' : '')).then(function (answer) {
      asked = true;
      lastRead = Date.now();
      if (answer.ok) state = answer.data;
      render();
      return answer;
    });
  }

  // ── The message under the panel ──
  function message(text, good, signInLink) {
    var box = $('cz-msg');
    if (!box) return;
    clear(box);
    if (!text) { show(box, false); return; }
    box.className = 'cz-msg' + (good ? ' ok' : '');
    box.appendChild(make('span', null, text));
    if (signInLink) {
      var link = make('a', null, T.signIn);
      link.href = '/auth/coaching-signin?for=' + encodeURIComponent(DATA.login);
      box.appendChild(link);
    }
    show(box, true);
  }
  function refusal(answer) { message(answer.text, false, answer.code === 'signin'); }

  // ── Drawing ──
  // The chosen length's starts that are still at least the hour of notice away (a page left open).
  function freeStarts(now) {
    return C.bookableStarts((state.slots && state.slots[minutes]) || [], now, state.leadMs);
  }

  function render() {
    var now = Date.now();
    var bookable = !!state.bookable;
    show($('cz-paused'), !bookable);
    show($('cz-picker'), bookable);
    show($('cz-length'), bookable);
    $('cz-zone').textContent = bookable ? fill(T.zone, fields()) : '';
    Array.prototype.forEach.call($('cz-length').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-minutes')) === minutes));
    });

    var starts = freeStarts(now);
    if (pick !== null && starts.indexOf(pick) < 0) pick = null;
    var days = C.groupByLocalDay(starts, zone, now, C.daysToShow(starts, zone, now, state.horizonDays || 14));
    if (!day || !days.some(function (d) { return d.date === day; })) {
      var first = days.filter(function (d) { return d.starts.length; })[0] || days[0];
      day = first ? first.date : null;
    }
    drawDays(days);
    var chosen = days.filter(function (d) { return d.date === day; })[0];
    drawSlots(chosen ? chosen.starts : []);
    var empty = $('cz-empty');
    empty.textContent = !starts.length ? T.noTimes : (chosen && !chosen.starts.length ? T.noTimesDay : '');
    show(empty, !!empty.textContent);
    drawPanel(now, bookable);
  }

  function drawDays(days) {
    var strip = $('cz-days');
    clear(strip);
    days.forEach(function (d) {
      var label = C.dayLabel(d.date, lang);
      var button = make('button', 'cz-day' + (d.starts.length ? '' : ' off'), label.weekday);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(d.date === day));
      button.appendChild(make('b', null, String(label.day)));
      button.addEventListener('click', function () { day = d.date; pick = null; message(''); render(); });
      strip.appendChild(button);
    });
  }

  function drawSlots(starts) {
    var grid = $('cz-slots');
    clear(grid);
    starts.forEach(function (s) {
      var button = make('button', 'cz-slot', time(s));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(s === pick));
      button.addEventListener('click', function () { pick = s === pick ? null : s; message(''); render(); });
      grid.appendChild(button);
    });
  }

  function drawPanel(now, bookable) {
    if (!$('cz-pick')) return; // signed out: the sign-in button is all the page offers
    show($('cz-pick-head'), bookable);
    $('cz-pick').textContent = pick !== null
      ? C.dateLabel(pick, zone, lang) + ' · ' + time(pick) + '–' + time(pick + minutes * 60e3)
      : T.pickTime;
    $('cz-pick-length').textContent = pick !== null ? lengthText(minutes) : '';

    var needJoin = bookable && state.member === false;
    var atLimit = C.upcomingCount(state.bookings, now) >= state.maxUpcoming;
    show($('cz-join'), needJoin);
    $('cz-join-title').textContent = fill(T.joinFirst, fields());
    var invite = $('cz-invite');
    if (state.inviteUrl) invite.href = state.inviteUrl;
    show(invite, !!state.inviteUrl);

    var limit = $('cz-limit');
    limit.textContent = fill(T.limit, fields());
    show(limit, bookable && !needJoin && atLimit);
    show($('cz-book'), bookable && !needJoin && !atLimit);
    var unverified = $('cz-unverified');
    unverified.textContent = fill(T.unverified, fields());
    show(unverified, asked && state.member === null);
    var request = $('cz-request');
    request.disabled = pick === null || busy || !asked;
    request.textContent = busy ? T.requesting : T.request;

    drawBookings(now);
  }

  function drawBookings(now) {
    var all = state.bookings || [];
    var upcoming = all.filter(function (b) { return b.startsAt > now; }).sort(function (a, b) { return a.startsAt - b.startsAt; });
    var past = all.filter(function (b) { return b.startsAt <= now; }).sort(function (a, b) { return b.startsAt - a.startsAt; });
    var list = $('cz-list');
    clear(list);
    upcoming.concat(past).forEach(function (b) {
      var line = make('div', 'cz-line');
      line.appendChild(make('span', 'cz-dot ' + b.state));
      var what = make('div', 'cz-what');
      what.appendChild(make('span', 't', C.dateLabel(b.startsAt, zone, lang) + ', ' + time(b.startsAt)));
      what.appendChild(make('span', 'cz-sub', ' · ' + lengthText(b.minutes)));
      if (b.note) what.appendChild(make('div', 'cz-sub', b.note));
      line.appendChild(what);
      line.appendChild(make('span', 'cz-pill ' + b.state, (T.states && T.states[b.state]) || b.state));
      if (C.canCancel(b, now)) {
        var cancel = make('button', 'cz-btn sm no', T.cancel);
        cancel.type = 'button';
        cancel.addEventListener('click', function () { withdraw(b.id, cancel); });
        line.appendChild(cancel);
      }
      list.appendChild(line);
    });
    show($('cz-mine'), all.length > 0);
  }

  // ── Actions ──
  function requestTime() {
    if (pick === null || busy) return;
    busy = true;
    message('');
    render();
    var note = $('cz-note');
    api('POST', base + '/book', { startsAt: pick, minutes: minutes, note: note.value }).then(function (answer) {
      busy = false;
      if (answer.ok) {
        note.value = '';
        pick = null;
        message(fill(T.requested, fields()), true);
      } else {
        refusal(answer);
      }
      return refresh();
    });
  }

  function withdraw(id, button) {
    if (!window.confirm(T.cancelConfirm)) return;
    button.disabled = true;
    api('POST', base + '/bookings/' + encodeURIComponent(String(id)) + '/cancel').then(function (answer) {
      if (answer.ok) message(T.withdrawn, true);
      else refusal(answer);
      return refresh();
    });
  }

  Array.prototype.forEach.call($('cz-length').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      minutes = Number(b.getAttribute('data-minutes')) === 30 ? 30 : 60;
      message('');
      render();
    });
  });
  if ($('cz-request')) $('cz-request').addEventListener('click', requestTime);
  if ($('cz-joined')) {
    $('cz-joined').addEventListener('click', function () {
      message('');
      refresh(true).then(function (answer) {
        if (!answer.ok) refusal(answer);
        else if (state.member === false) message(fill(T.notJoined, fields()));
      });
    });
  }
  // A page left open: read again when it is looked at after a minute away.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastRead > STALE_MS && !busy) refresh();
  });

  render();
  if (state.viewer) refresh();
})();
