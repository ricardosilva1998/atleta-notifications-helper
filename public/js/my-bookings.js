// My bookings (views/my-bookings.ejs, routes/myBookings.js): the viewer's coaching bookings with every coach, to come and
// past, drawn from window.MYBOOKINGS_DATA and again from each answer of GET /my-bookings/state. Each booking carries its
// coach; its actions (pay, withdraw, the reschedule answers) post to /coaching/<coach login>/bookings/:id/... Times arrive
// as UTC instants and are shown in the viewer's own time zone (window.COACHING_CORE, public/js/coaching-core.js). Texts
// come from window.MYBOOKINGS_TEXTS, with their {{fields}} filled here in one pass; every text, name and note goes in
// with textContent. public/js/csrf.js adds the session's token to the POSTs.
(function () {
  'use strict';

  var DATA = window.MYBOOKINGS_DATA || {};
  var T = window.MYBOOKINGS_TEXTS || {};
  var C = window.COACHING_CORE;
  if (!C || !DATA.viewer) return;

  var REQUEST_MS = 20000;
  var STALE_MS = 60000;
  var lang = DATA.lang || 'en';
  var zone = 'UTC';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    new Intl.DateTimeFormat('en', { timeZone: zone }); // a zone this browser cannot format with counts as UTC
  } catch (e) { zone = 'UTC'; }

  var state = DATA;
  var busy = false;
  var panel = null; // the reschedule panel that is open: { id, starts, minutes, day, pick, note, loading }
  var search = window.location.search;
  var linkedBooking = C.bookingFromSearch(search); // ?booking=<id>: that booking comes into view once
  var linkedId = linkedBooking; // kept after the scroll, for the notices
  var justSent = /(?:^|[?&])new=1(?:&|$)/.test(search); // &new=1: a request that was just sent
  var highlighted = null;
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
  function lengthText(m) { return C.lengthLabel(m, { lengthMin: T.lengthMin, lengthHour: T.lengthHour }); }
  function price(cents, currency) { return C.formatPrice(cents, currency, lang, T.free); }
  function time(ms) { return C.timeLabel(ms, zone, lang); }
  function whenOf(ms) { return C.dateLabel(ms, zone, lang) + ', ' + time(ms); }
  function bookingById(id) { return (state.bookings || []).filter(function (b) { return b.id === id; })[0]; }
  function base(b) { return '/coaching/' + encodeURIComponent(b.coach.login); }
  function bookingUrl(b, tail) { return base(b) + '/bookings/' + encodeURIComponent(String(b.id)) + tail; }

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

  function refresh() {
    return api('GET', '/my-bookings/state').then(function (answer) {
      lastRead = Date.now();
      if (answer.ok) state = answer.data;
      render();
      return answer;
    });
  }

  // ── The message at the top ──
  function message(text, good, signInLink) {
    var box = $('cz-msg');
    if (!box) return;
    clear(box);
    if (!text) { show(box, false); return; }
    box.className = 'cz-msg' + (good ? ' ok' : '');
    box.appendChild(make('span', null, text));
    if (signInLink) {
      var link = make('a', null, T.signIn);
      link.href = DATA.signInUrl || '/auth/coaching-signin';
      box.appendChild(link);
    }
    show(box, true);
  }
  function refusal(answer) { message(answer.text, false, answer.code === 'signin'); }

  // ── Drawing ──
  function render() {
    var now = Date.now();
    var all = state.bookings || [];
    var coming = all.filter(function (b) { return b.startsAt > now || C.upcomingCount([b], now) > 0; })
      .sort(function (a, b) { return a.startsAt - b.startsAt; });
    var past = all.filter(function (b) { return coming.indexOf(b) < 0; }).sort(function (a, b) { return b.startsAt - a.startsAt; });
    var root = $('mb-lists');
    clear(root);
    drawNew();
    if (!all.length) root.appendChild(make('p', 'cz-empty', T.none));
    [[T.toCome, coming], [T.past, past]].forEach(function (group) {
      if (!group[1].length) return;
      root.appendChild(make('div', 'cz-group', group[0]));
      var list = make('div');
      group[1].forEach(function (b) { drawBooking(list, b, now); });
      root.appendChild(list);
    });
    openLinked(now);
  }

  // A request that was just sent stays at the top, with its coach's name.
  function drawNew() {
    var box = $('mb-new');
    var b = justSent && linkedId !== null ? bookingById(linkedId) : null;
    if (!b) { show(box, false); return; }
    box.textContent = fill(T.requestSent, { name: b.coach.name });
    show(box, true);
  }

  function avatarOf(coach) {
    var img = make('img', 'cz-avatar');
    img.alt = '';
    img.width = 30;
    img.height = 30;
    if (coach.avatar && /^https:\/\//.test(coach.avatar)) img.src = coach.avatar;
    return img;
  }

  function drawBooking(list, b, now) {
    var line = make('div', 'cz-line mb-line' + (highlighted === b.id ? ' hl' : ''));
    line.setAttribute('data-booking', String(b.id));
    line.appendChild(avatarOf(b.coach));
    var what = make('div', 'cz-what');
    var coachLink = make('a', 'mb-coach');
    coachLink.href = base(b);
    coachLink.appendChild(make('span', null, b.coach.name));
    what.appendChild(coachLink);
    var when = make('div');
    when.appendChild(make('span', 't', whenOf(b.startsAt)));
    var cost = b.paid ? fill(T.paidAmount, { price: price(b.paidAmountCents, b.paidCurrency) }) : (b.priceCents == null ? '' : price(b.priceCents, b.currency));
    when.appendChild(make('span', 'cz-sub', ' · ' + lengthText(b.minutes) + (cost ? ' · ' + cost : '')));
    what.appendChild(when);
    var active = !!b.coach.available;
    if (b.state === 'awaiting_payment' && b.payBy) what.appendChild(make('div', 'cz-sub', fill(T.payBy, { when: C.payByLabel(b.payBy, zone, lang) })));
    if (b.state === 'confirmed' && b.roomUrl && C.isRoomUrl(b.roomUrl)) {
      var link = make('a', 'cz-sub', T.room);
      link.href = b.roomUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      var wrap = make('div');
      wrap.appendChild(link);
      what.appendChild(wrap);
    }
    if (b.note) what.appendChild(make('div', 'cz-sub', b.note));
    if (b.state === 'cancelled' && b.cancelReason) what.appendChild(make('div', 'cz-sub', fill(T.cancelReason, { reason: b.cancelReason })));
    var refund = C.refundLine(b);
    if (refund === 'pending') what.appendChild(make('div', 'cz-sub cz-refund pending', T.refundPending));
    if (refund === 'refunded') what.appendChild(make('div', 'cz-sub cz-refund done', T.refunded));
    var mode = C.rescheduleMode(b, now);
    if (mode) drawRescheduleInfo(what, b, mode);
    if (!active) what.appendChild(make('div', 'cz-sub mb-off', fill(T.unavailable, { name: b.coach.name })));
    line.appendChild(what);
    line.appendChild(make('span', 'cz-pill ' + b.state, (T.states && T.states[b.state]) || b.state));
    var canAct = active && (C.canPay(b, now) || C.canCancel(b, now) || mode === 'answer' || mode === 'pick');
    if (canAct) {
      var actions = make('div', 'cz-actions');
      if (mode === 'answer') {
        var accept = make('button', 'cz-btn sm', T.reschedAccept);
        accept.type = 'button';
        accept.addEventListener('click', function () { acceptProposal(b, accept); });
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
        payButton.addEventListener('click', function () { startPayment(b, payButton); });
        actions.appendChild(payButton);
        actions.appendChild(make('div', 'cz-sub cz-paynote', fill(T.payNote, { name: b.coach.name })));
      }
      if (C.canCancel(b, now)) {
        var cancel = make('button', 'cz-btn sm no', T.cancel);
        cancel.type = 'button';
        cancel.addEventListener('click', function () { withdraw(b, cancel); });
        actions.appendChild(cancel);
      }
      line.appendChild(actions);
    }
    list.appendChild(line);
    if (active && panel && panel.id === b.id && (mode === 'answer' || mode === 'pick')) list.appendChild(drawPanelFor(b));
  }

  // Where a session being rescheduled stands: the coach's proposal, the viewer's own, or the request to pick; the original
  // time; and when it closes without a new time.
  function drawRescheduleInfo(what, b, mode) {
    var p = b.proposal;
    var name = b.coach.name;
    if (mode === 'answer') what.appendChild(make('div', 'cz-sub cz-hl', fill(T.reschedProposed, { name: name, when: whenOf(p.startsAt) })));
    else if (mode === 'wait') what.appendChild(make('div', 'cz-sub cz-hl', fill(T.reschedMine, { name: name, when: whenOf(p.startsAt) })));
    else what.appendChild(make('div', 'cz-sub cz-hl', fill(T.reschedAsk, { name: name })));
    if (p && p.note && mode !== 'wait') what.appendChild(make('div', 'cz-sub', p.note));
    if (b.originalStartsAt) what.appendChild(make('div', 'cz-sub', fill(T.reschedOriginal, { when: whenOf(b.originalStartsAt) })));
    if (b.rescheduleEndsAt) what.appendChild(make('div', 'cz-sub', fill(T.reschedUntil, { when: whenOf(b.rescheduleEndsAt) })));
  }

  // ── The reschedule panel: pick a new time (from the server's list, which leaves out the original time and held ones)
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
    send.addEventListener('click', function () { sendProposal(b); });
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
    var b = bookingById(id);
    if (!b) return;
    panel = { id: id, starts: [], minutes: b.minutes, day: null, pick: null, note: '', loading: true };
    render();
    api('GET', bookingUrl(b, '/starts')).then(function (answer) {
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

  // ?booking=<id> brings that booking into view once (and opens the pick panel when it asks the viewer to pick).
  function openLinked(now) {
    if (linkedBooking === null) return;
    var id = linkedBooking;
    var b = bookingById(id);
    if (!b) return;
    linkedBooking = null;
    highlighted = id;
    var line = $('mb-lists').querySelector('[data-booking="' + id + '"]');
    if (line) {
      line.classList.add('hl');
      if (line.scrollIntoView) line.scrollIntoView({ block: 'center' });
    }
    if (b.coach.available && C.rescheduleMode(b, now) === 'pick') togglePanel(id);
  }

  // ── Actions ──
  function acceptProposal(b, button) {
    button.disabled = true;
    message('');
    api('POST', bookingUrl(b, '/accept-proposal')).then(function (answer) {
      if (answer.ok) { panel = null; message(T.reschedAgreed, true); }
      else refusal(answer);
      return refresh();
    });
  }

  function sendProposal(b) {
    if (!panel || panel.id !== b.id || panel.pick === null || busy) return;
    busy = true;
    message('');
    render();
    api('POST', bookingUrl(b, '/propose'), { startsAt: panel.pick, note: panel.note || '' }).then(function (answer) {
      busy = false;
      if (answer.ok) { panel = null; message(fill(T.reschedSent, { name: b.coach.name }), true); }
      else refusal(answer);
      return refresh();
    });
  }

  function withdraw(b, button) {
    if (!window.confirm(T.cancelConfirm)) return;
    button.disabled = true;
    api('POST', bookingUrl(b, '/cancel')).then(function (answer) {
      if (answer.ok) message(T.withdrawn, true);
      else refusal(answer);
      return refresh();
    });
  }

  function startPayment(b, button) {
    button.disabled = true;
    button.textContent = T.paying;
    message('');
    api('POST', bookingUrl(b, '/pay')).then(function (answer) {
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
    var notice = C.returnNotice(search);
    if (!notice) return;
    var linked = linkedId !== null ? bookingById(linkedId) : null;
    if (notice.kind === 'paid') {
      message(T.paidOk, true);
    } else {
      message((T.returnErrors && T.returnErrors[notice.code]) || T.failed, false);
      if (notice.order && linked) {
        var again = make('a', null, T.checkAgain);
        again.href = base(linked) + '/paid?token=' + encodeURIComponent(notice.order);
        $('cz-msg').appendChild(again);
      }
    }
  }

  // A page left open: read again when it is looked at after a minute away.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastRead > STALE_MS && !busy) refresh();
  });

  render();
  showReturn();
  refresh();
})();
