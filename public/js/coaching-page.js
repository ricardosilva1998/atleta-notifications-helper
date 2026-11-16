// The coaching booking page (views/coaching.ejs, routes/coaching.js) as four steps, one at a time: 1 connect Discord
// (printed by the server, a link), 2 join the server (Next only once Discord shows them in it; when Discord cannot say
// they may go on with a warning), 3 length, 4 day, time and the optional message, then Send request, after which the
// viewer lands on My bookings. The steps draw from window.COACHING_DATA.state, and again from each answer of
// GET /coaching/<login>/state; the step to open at is COACHING_CORE.stepFor(state). Times
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
  var minutes = null; // the chosen length; set by render() to one that has a free start
  var day = null; // the chosen day (YYYY-MM-DD in the viewer's zone)
  var pick = null; // the chosen start (UTC ms)
  var busy = false;
  var step = null; // the step on show (2-4); set by render()
  var shown = null; // the step drawn last, to move focus when it changes
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
  function lengthText(m) { return C.lengthLabel(m, { lengthMin: T.lengthMin, lengthHour: T.lengthHour }); }
  function price(cents, currency) { return C.formatPrice(cents, currency || state.currency, lang, T.free); }
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
  function priceOf(m) {
    var found = (state.lengths || []).filter(function (l) { return l.minutes === m; })[0];
    return found ? found.priceCents : 0;
  }
  // The chosen length's starts that are still at least the hour of notice away (a page left open).
  function freeStarts(now) {
    return C.bookableStarts((state.slots && state.slots[minutes]) || [], now, state.leadMs);
  }

  // The lengths with a free start, each with its price; the chosen one stays if it is still offered, else the first.
  function offered(now) {
    var list = C.lengthsToShow(state.lengths, state.slots, now, state.leadMs);
    if (!list.some(function (l) { return l.minutes === minutes; })) { minutes = list.length ? list[0].minutes : null; pick = null; }
    return list;
  }

  function goTo(n) { step = n; message(''); render(); }

  function render() {
    // Signed out, or nothing to book: the server printed all there is (the Connect Discord step, or the paused text).
    if (!$('cz-s3')) return;
    var now = Date.now();
    var bookable = !!state.bookable;
    var list = offered(now);
    var atLimit = C.upcomingCount(state.bookings, now) >= state.maxUpcoming;

    if (!asked) { [2, 3, 4].forEach(function (n) { show($('cz-s' + n), false); }); return; }
    var cap = C.stepFor(state);
    if (step === null) step = cap;
    if (state.member === false) step = 2; // Discord no longer shows them in the server: join first
    if (step === 4 && (atLimit || minutes === null)) step = 3;
    $('cz-zone').textContent = bookable ? fill(T.zone, fields()) : '';

    // Step 2: join
    $('cz-join-title').textContent = fill(T.joinFirst, fields());
    var invite = $('cz-invite');
    if (state.inviteUrl) invite.href = state.inviteUrl;
    show(invite, !!state.inviteUrl);
    var unverified = $('cz-unverified');
    unverified.textContent = fill(T.unverified, fields());
    show(unverified, state.member === null);
    $('cz-next-2').disabled = state.member === false;

    // Step 3: length
    drawLengths(list);
    var none = $('cz-empty-length');
    none.textContent = list.length ? '' : T.noTimes;
    show(none, !list.length && !atLimit); // at the limit the limit text says why, not "no free times"
    var limit = $('cz-limit');
    limit.textContent = fill(T.limit, fields());
    show(limit, atLimit);
    $('cz-next-3').disabled = atLimit || minutes === null;
    show($('cz-next-3'), !atLimit);
    show($('cz-back-3'), C.backStep(3, state) !== null);

    // Step 4: day, time and message
    var starts = minutes === null ? [] : freeStarts(now);
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
    $('cz-chosen').textContent = minutes === null ? '' : lengthText(minutes) + ' · ' + price(priceOf(minutes))
      + (pick !== null ? ' · ' + C.dateLabel(pick, zone, lang) + ', ' + time(pick) + '–' + time(pick + minutes * 60e3) : '');
    var request = $('cz-request');
    request.disabled = pick === null || busy || minutes === null;
    request.textContent = busy ? T.requesting : T.request;

    [2, 3, 4].forEach(function (n) { show($('cz-s' + n), step === n); });
    if (shown !== null && shown !== step) {
      var heading = $('cz-step-' + step);
      if (heading) heading.focus();
    }
    shown = step;
  }

  function drawLengths(list) {
    var group = $('cz-length');
    clear(group);
    show(group, list.length > 0);
    list.forEach(function (l) {
      var button = make('button', 'cz-len', lengthText(l.minutes));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(l.minutes === minutes));
      button.appendChild(make('b', null, price(l.priceCents)));
      button.addEventListener('click', function () { minutes = l.minutes; pick = null; message(''); render(); });
      group.appendChild(button);
    });
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

  // ── Actions ──
  function requestTime() {
    if (pick === null || busy) return;
    busy = true;
    message('');
    render();
    api('POST', base + '/book', { startsAt: pick, minutes: minutes, note: $('cz-note').value }).then(function (answer) {
      busy = false;
      if (answer.ok && answer.data && answer.data.booking && answer.data.booking.id) {
        window.location.assign('/my-bookings?booking=' + encodeURIComponent(String(answer.data.booking.id)) + '&new=1');
        return null;
      }
      pick = null;
      refusal(answer.ok ? { text: T.failed } : answer);
      return refresh();
    });
  }

  if ($('cz-request')) $('cz-request').addEventListener('click', requestTime);
  if ($('cz-next-2')) $('cz-next-2').addEventListener('click', function () { goTo(3); });
  if ($('cz-next-3')) $('cz-next-3').addEventListener('click', function () { goTo(4); });
  if ($('cz-back-3')) $('cz-back-3').addEventListener('click', function () { goTo(C.backStep(3, state) || 3); });
  if ($('cz-back-4')) $('cz-back-4').addEventListener('click', function () { goTo(3); });
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
