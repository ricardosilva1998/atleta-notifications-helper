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
  var minutes = null; // the chosen length; set by render() to one that has a free start
  var day = null; // the chosen day (YYYY-MM-DD in the viewer's zone)
  var pick = null; // the chosen start (UTC ms)
  var busy = false;
  var panel = null; // the reschedule panel that is open: { id, starts, minutes, day, pick, loading }
  var linkedBooking = C.bookingFromSearch(window.location.search); // ?booking=<id>: that booking's panel opens once
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
  // The chosen length's starts that are still at least the hour of notice away (a page left open).
  function priceOf(m) {
    var found = (state.lengths || []).filter(function (l) { return l.minutes === m; })[0];
    return found ? found.priceCents : 0;
  }
  function freeStarts(now) {
    return C.bookableStarts((state.slots && state.slots[minutes]) || [], now, state.leadMs);
  }

  // The lengths with a free start, each with its price; the chosen one stays if it is still offered, else the first.
  function offered(now) {
    var list = C.lengthsToShow(state.lengths, state.slots, now, state.leadMs);
    if (!list.some(function (l) { return l.minutes === minutes; })) { minutes = list.length ? list[0].minutes : null; pick = null; }
    return list;
  }

  function render() {
    var now = Date.now();
    var bookable = !!state.bookable;
    var picker = $('cz-picker');
    if (!picker) return; // signed out: Connect Discord is all the page offers
    var needJoin = bookable && state.member === false;
    show($('cz-paused'), !bookable);
    show(picker, bookable && asked && !needJoin);
    $('cz-zone').textContent = bookable ? fill(T.zone, fields()) : '';
    var list = offered(now);
    drawLengths(list);

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
    drawPanel(now, bookable);
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

  function drawPanel(now, bookable) {
    show($('cz-pick-head'), bookable && asked && state.member !== false);
    $('cz-pick').textContent = pick !== null
      ? C.dateLabel(pick, zone, lang) + ' · ' + time(pick) + '–' + time(pick + minutes * 60e3)
      : T.pickTime;
    $('cz-pick-length').textContent = pick !== null ? lengthText(minutes) + ' · ' + price(priceOf(minutes)) : '';

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
    show($('cz-book'), bookable && asked && !needJoin && !atLimit);
    var unverified = $('cz-unverified');
    unverified.textContent = fill(T.unverified, fields());
    show(unverified, asked && state.member === null);
    var request = $('cz-request');
    request.disabled = pick === null || busy || !asked || minutes === null;
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
      line.setAttribute('data-booking', String(b.id));
      line.appendChild(make('span', 'cz-dot ' + b.state));
      var what = make('div', 'cz-what');
      what.appendChild(make('span', 't', C.dateLabel(b.startsAt, zone, lang) + ', ' + time(b.startsAt)));
      var cost = b.paid ? fill(T.paidAmount, { price: price(b.paidAmountCents, b.paidCurrency) }) : (b.priceCents == null ? '' : price(b.priceCents, b.currency));
      what.appendChild(make('span', 'cz-sub', ' · ' + lengthText(b.minutes) + (cost ? ' · ' + cost : '')));
      if (b.state === 'awaiting_payment' && b.payBy) {
        what.appendChild(make('div', 'cz-sub', fill(T.payBy, { when: C.payByLabel(b.payBy, zone, lang) })));
      }
      if (b.state === 'confirmed') {
        if (b.roomUrl && C.isRoomUrl(b.roomUrl)) {
          var link = make('a', 'cz-sub', T.room);
          link.href = b.roomUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          var wrap = make('div');
          wrap.appendChild(link);
          what.appendChild(wrap);
        } else if (state.whereText) {
          what.appendChild(make('div', 'cz-sub', fill(T.where, { where: state.whereText })));
        }
      }
      if (b.note) what.appendChild(make('div', 'cz-sub', b.note));
      if (b.state === 'cancelled' && b.cancelReason) what.appendChild(make('div', 'cz-sub', fill(T.cancelReason, { reason: b.cancelReason })));
      var refund = C.refundLine(b);
      if (refund === 'pending') what.appendChild(make('div', 'cz-sub cz-refund pending', T.refundPending));
      if (refund === 'refunded') what.appendChild(make('div', 'cz-sub cz-refund done', T.refunded));
      var mode = C.rescheduleMode(b, now);
      if (mode) drawRescheduleInfo(what, b, mode);
      line.appendChild(what);
      line.appendChild(make('span', 'cz-pill ' + b.state, (T.states && T.states[b.state]) || b.state));
      var actions = null;
      var canAct = C.canPay(b, now) || C.canCancel(b, now) || mode === 'answer' || mode === 'pick';
      if (canAct) {
        actions = make('div', 'cz-actions');
        if (mode === 'answer') {
          var accept = make('button', 'cz-btn sm', T.reschedAccept);
          accept.type = 'button';
          accept.addEventListener('click', function () { acceptProposal(b.id, accept); });
          actions.appendChild(accept);
        }
        if (mode === 'answer' || mode === 'pick') {
          var other = make('button', 'cz-btn sm ghost', mode === 'pick' ? T.reschedPick : T.reschedOther);
          other.type = 'button';
          other.setAttribute('aria-expanded', String(!!panel && panel.id === b.id));
          other.addEventListener('click', function () { togglePanel(b.id); });
          actions.appendChild(other);
        }
        if (C.canPay(b, now)) {
          var payButton = make('button', 'cz-btn sm', fill(T.pay, { price: price(b.priceCents, b.currency) }));
          payButton.type = 'button';
          payButton.addEventListener('click', function () { startPayment(b.id, payButton); });
          actions.appendChild(payButton);
          actions.appendChild(make('div', 'cz-sub cz-paynote', fill(T.payNote, fields())));
        }
        if (C.canCancel(b, now)) {
          var cancel = make('button', 'cz-btn sm no', T.cancel);
          cancel.type = 'button';
          cancel.addEventListener('click', function () { withdraw(b.id, cancel); });
          actions.appendChild(cancel);
        }
        line.appendChild(actions);
      }
      list.appendChild(line);
      if (panel && panel.id === b.id && (mode === 'answer' || mode === 'pick')) list.appendChild(drawPanelFor(b));
    });
    show($('cz-mine'), all.length > 0);
    openLinked(now);
  }

  // Where a session being rescheduled stands: the coach's proposal, the viewer's own, or the request to pick; the original
  // time; and when it closes without a new time.
  function drawRescheduleInfo(what, b, mode) {
    var p = b.proposal;
    if (mode === 'answer') what.appendChild(make('div', 'cz-sub cz-hl', fill(T.reschedProposed, { name: DATA.name, when: whenOf(p.startsAt) })));
    else if (mode === 'wait') what.appendChild(make('div', 'cz-sub cz-hl', fill(T.reschedMine, { name: DATA.name, when: whenOf(p.startsAt) })));
    else what.appendChild(make('div', 'cz-sub cz-hl', fill(T.reschedAsk, { name: DATA.name })));
    if (p && p.note && mode !== 'wait') what.appendChild(make('div', 'cz-sub', p.note));
    if (b.originalStartsAt) what.appendChild(make('div', 'cz-sub', fill(T.reschedOriginal, { when: whenOf(b.originalStartsAt) })));
    if (b.rescheduleEndsAt) what.appendChild(make('div', 'cz-sub', fill(T.reschedUntil, { when: whenOf(b.rescheduleEndsAt) })));
  }
  function whenOf(ms) { return C.dateLabel(ms, zone, lang) + ', ' + time(ms); }

  // ── The reschedule panel: pick a new time (from the server's list, which leaves out the original time and held ones)
  function bookingById(id) { return (state.bookings || []).filter(function (b) { return b.id === id; })[0]; }

  function drawPanelFor(b) {
    var box = make('div', 'cz-resched');
    box.id = 'cz-resched-' + b.id;
    if (panel.loading) { box.appendChild(make('p', 'cz-sub', T.reschedLoading)); return box; }
    var now = Date.now();
    var starts = C.bookableStarts(panel.starts || [], now, state.leadMs);
    if (!starts.length) { box.appendChild(make('p', 'cz-sub', T.reschedNoTimes)); box.appendChild(closeButton()); return box; }
    var days = C.groupByLocalDay(starts, zone, now, C.daysToShow(starts, zone, now, state.horizonDays || 14));
    if (!panel.day || !days.some(function (d) { return d.date === panel.day; })) {
      var first = days.filter(function (d) { return d.starts.length; })[0];
      panel.day = first ? first.date : null;
    }
    if (panel.pick !== null && starts.indexOf(panel.pick) < 0) panel.pick = null;
    var strip = make('div', 'cz-days');
    days.forEach(function (d) {
      var label = C.dayLabel(d.date, lang);
      var button = make('button', 'cz-day' + (d.starts.length ? '' : ' off'), label.weekday);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(d.date === panel.day));
      button.appendChild(make('b', null, String(label.day)));
      button.addEventListener('click', function () { panel.day = d.date; panel.pick = null; render(); });
      strip.appendChild(button);
    });
    box.appendChild(strip);
    var chosen = days.filter(function (d) { return d.date === panel.day; })[0];
    var grid = make('div', 'cz-slots');
    (chosen ? chosen.starts : []).forEach(function (s) {
      var button = make('button', 'cz-slot', time(s));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(s === panel.pick));
      button.addEventListener('click', function () { panel.pick = s === panel.pick ? null : s; render(); });
      grid.appendChild(button);
    });
    box.appendChild(grid);
    if (panel.pick !== null) box.appendChild(make('p', 'cz-sub cz-hl', fill(T.reschedPicked, { when: whenOf(panel.pick) + '–' + time(panel.pick + panel.minutes * 60e3) })));
    var note = make('textarea', 'cz-note');
    note.id = 'cz-resched-note';
    note.maxLength = 300;
    note.rows = 2;
    note.placeholder = T.reschedNote;
    note.setAttribute('aria-label', T.reschedNote);
    note.value = panel.note || '';
    note.addEventListener('input', function () { panel.note = note.value; });
    box.appendChild(note);
    var row = make('div', 'cz-actions');
    var send = make('button', 'cz-btn sm', T.reschedSend);
    send.type = 'button';
    send.disabled = panel.pick === null || busy;
    send.addEventListener('click', function () { sendProposal(b.id); });
    row.appendChild(send);
    row.appendChild(closeButton());
    box.appendChild(row);
    return box;
  }
  function closeButton() {
    var button = make('button', 'cz-btn sm ghost', T.reschedClose);
    button.type = 'button';
    button.addEventListener('click', function () { panel = null; render(); });
    return button;
  }

  function togglePanel(id) {
    if (panel && panel.id === id) { panel = null; render(); return; }
    panel = { id: id, starts: [], minutes: (bookingById(id) || {}).minutes, day: null, pick: null, note: '', loading: true };
    render();
    api('GET', base + '/bookings/' + encodeURIComponent(String(id)) + '/starts').then(function (answer) {
      if (!panel || panel.id !== id) return;
      if (answer.ok) {
        panel.starts = answer.data.starts || [];
        panel.minutes = answer.data.minutes || panel.minutes;
        panel.loading = false;
        render();
      } else {
        panel = null;
        refusal(answer);
        refresh();
      }
    });
  }

  // ?booking=<id> opens that booking's panel (the session to reschedule, from the Discord message) once, and brings it into view.
  function openLinked(now) {
    if (linkedBooking === null || !asked) return;
    var id = linkedBooking;
    linkedBooking = null;
    var b = bookingById(id);
    if (!b) return;
    var line = $('cz-list').querySelector('[data-booking="' + id + '"]');
    if (line && line.scrollIntoView) line.scrollIntoView({ block: 'center' });
    var mode = C.rescheduleMode(b, now);
    if (mode === 'pick') togglePanel(id);
  }

  function acceptProposal(id, button) {
    button.disabled = true;
    message('');
    api('POST', base + '/bookings/' + encodeURIComponent(String(id)) + '/accept-proposal').then(function (answer) {
      if (answer.ok) { panel = null; message(T.reschedAgreed, true); }
      else refusal(answer);
      return refresh();
    });
  }

  function sendProposal(id) {
    if (!panel || panel.id !== id || panel.pick === null || busy) return;
    busy = true;
    message('');
    render();
    api('POST', base + '/bookings/' + encodeURIComponent(String(id)) + '/propose', { startsAt: panel.pick, note: panel.note || '' }).then(function (answer) {
      busy = false;
      if (answer.ok) { panel = null; message(fill(T.reschedSent, { name: DATA.name }), true); }
      else refusal(answer);
      return refresh();
    });
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

  function startPayment(id, button) {
    button.disabled = true;
    button.textContent = T.paying;
    message('');
    api('POST', base + '/bookings/' + encodeURIComponent(String(id)) + '/pay').then(function (answer) {
      if (answer.ok && answer.data && C.isPayPalUrl(answer.data.approveUrl)) {
        window.location.assign(answer.data.approveUrl);
        return null;
      }
      refusal(answer.ok ? { text: T.failed } : answer);
      return refresh();
    });
  }

  // PayPal's return: ?paid=1, or ?error=<code> (an unconfirmed payment also &order=<id>, to check again).
  function showReturn() {
    var notice = C.returnNotice(window.location.search);
    if (!notice) return;
    if (notice.kind === 'paid') {
      message(T.paidOk, true);
    } else {
      message((T.returnErrors && T.returnErrors[notice.code]) || T.failed, false);
      if (notice.order) {
        var again = make('a', null, T.checkAgain);
        again.href = base + '/paid?token=' + encodeURIComponent(notice.order);
        $('cz-msg').appendChild(again);
      }
    }
    if (window.history && window.history.replaceState && !notice.order) window.history.replaceState(null, '', base);
  }

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
  if (state.viewer) { showReturn(); refresh(); }
})();
