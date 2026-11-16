// The streamer's coaching page (views/coaching-dashboard.ejs, routes/coachingDashboard.js), in four tabs (Bookings,
// Schedule, Price, Settings; the open one is kept in localStorage 'coaching_tab'). It draws the Bookings (the bookings
// to come by day, with Accept and Decline for a waiting request, Reschedule and Cancel (with a reason, in a pop-up),
// the state of a reschedule with Accept and Propose another time, and the refunds to make with Refunded; the last 30
// days below) and the parts of the form that the server leaves to it (the seven weekday rows, the days off, the
// lengths, the status line), from window.COACHING_DASHBOARD_DATA, and redraws from each answer of the JSON routes under
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
  var LENGTH_MINUTES = [30, 60, 120, 180, 240, 300];
  var lengths = copyLengths(settings.lengths);
  var money = DATA.money || { currency: 'EUR', hasPaypal: true, checkPrices: false };
  var connections = DATA.connections || null;
  var categories = DATA.categories || [];
  var saving = false;
  var limits = DATA.limits || { cancelReasonMax: 500, noteMax: 300, proposalLapseMs: 48 * 3600e3 };
  var TABS = ['bookings', 'schedule', 'price', 'settings'];
  // The tab a refused save names: its field is there.
  var TAB_OF_CODE = {
    bad_zone: 'schedule', bad_hours: 'schedule', bad_days_off: 'schedule',
    bad_lengths: 'price', no_length: 'price',
    bad_server: 'settings', bad_invite: 'settings', invite_other_server: 'settings', bad_where: 'settings', bad_switch: 'settings',
    bad_category: 'settings', category_not_found: 'settings', category_permissions: 'settings', bad_paypal: 'settings',
  };

  function copyLengths(map) {
    var out = {};
    LENGTH_MINUTES.forEach(function (m) {
      var l = map && map[m] ? map[m] : { on: false, price: 0 };
      out[m] = { on: !!l.on, price: Number(l.price) || 0 };
    });
    return out;
  }

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
  function lengthText(m) { return C.lengthLabel(m, T); }
  function priceText(cents, currency) { return C.formatPrice(cents, currency || money.currency, lang, T.free); }

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

  // The form's message line: one in each tab's panel, only the open tab's is seen.
  function formMessage(text, tone) {
    Array.prototype.forEach.call(document.querySelectorAll('.cd-formmsg'), function (box) {
      clearTimeout(box._timer);
      box.textContent = text || '';
      box.className = 'cd-msg cd-formmsg' + (tone ? ' ' + tone : '');
      show(box, !!text);
      if (text && tone === 'ok') box._timer = setTimeout(function () { show(box, false); }, OK_MS);
    });
  }

  // ── Tabs ──

  function openTab(name, focus) {
    if (TABS.indexOf(name) < 0) name = 'bookings';
    document.documentElement.setAttribute('data-coaching-tab', name);
    try { localStorage.setItem('coaching_tab', name); } catch (e) { /* storage refused: the tab is not kept */ }
    TABS.forEach(function (t) {
      var button = $('cd-tabbtn-' + t);
      if (!button) return;
      button.setAttribute('aria-selected', t === name ? 'true' : 'false');
      button.tabIndex = t === name ? 0 : -1;
    });
    if (focus) $('cd-tabbtn-' + name).focus();
  }
  TABS.forEach(function (name, i) {
    var button = $('cd-tabbtn-' + name);
    button.addEventListener('click', function () { openTab(name); });
    button.addEventListener('keydown', function (e) {
      var to = null;
      if (e.key === 'ArrowRight') to = TABS[(i + 1) % TABS.length];
      else if (e.key === 'ArrowLeft') to = TABS[(i + TABS.length - 1) % TABS.length];
      else if (e.key === 'Home') to = TABS[0];
      else if (e.key === 'End') to = TABS[TABS.length - 1];
      if (to) { e.preventDefault(); openTab(to, true); }
    });
  });
  // The notes' links ("Check the prices", "Fix the invite") open the tab their field is in, then go to it.
  Array.prototype.forEach.call(document.querySelectorAll('a[data-cd-tab]'), function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      openTab(link.getAttribute('data-cd-tab'));
      var target = $((link.getAttribute('href') || '').slice(1));
      if (target) { target.scrollIntoView({ block: 'center' }); if (target.focus) target.focus({ preventScroll: true }); }
    });
  });
  openTab(document.documentElement.getAttribute('data-coaching-tab'));

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
    var placedAt = function (b) { return b.state === 'rescheduling' && b.proposal ? b.proposal.startsAt : b.startsAt; };
    all.sort(function (a, b) { return placedAt(a) - placedAt(b); }).forEach(function (b) {
      if (b.state !== 'rescheduling' && b.startsAt + b.minutes * MINUTE_MS <= now) { past.unshift(b); return; }
      var date = C.localDate(placedAt(b), zone);
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

  // A booking changed by an answer: put in its place and drawn again (a new time can move it to another day).
  function refresh(updated) {
    replaceBooking(updated);
    regroup();
    drawSchedule();
  }

  function iconButton(className, glyph, label, onClick) {
    var button = make('button', 'cd-icon ' + className, glyph);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }

  // The room's link while it is open, or why it failed with Retry room.
  function roomParts(b, what, line) {
    if (b.roomUrl && C.isRoomUrl(b.roomUrl)) {
      var box = make('div', 'cd-room');
      var link = make('a', null, T.openRoom);
      link.href = b.roomUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      box.appendChild(link);
      what.appendChild(box);
    } else if (b.roomError) {
      var fail = make('div', 'cd-room');
      fail.appendChild(make('span', 'cd-warn', (T.roomError && (T.roomError[b.roomError] || T.roomError.failed)) || ''));
      var retry = make('button', 'cd-sbtn', T.retryRoom);
      retry.type = 'button';
      retry.addEventListener('click', function () { retryRoom(b, retry, line); });
      fail.appendChild(retry);
      what.appendChild(fail);
    }
  }

  function retryRoom(b, button, line) {
    button.disabled = true;
    button.textContent = T.retrying;
    api('POST', '/dashboard/api/coaching/bookings/' + encodeURIComponent(String(b.id)) + '/room').then(function (answer) {
      if (!answer.ok) {
        button.disabled = false;
        button.textContent = T.retryRoom;
        message('cd-schedule-msg', answer.text);
        return;
      }
      replaceBooking(answer.data.booking);
      drawSchedule();
      message('cd-schedule-msg', fill(T.roomRetried, { name: answer.data.booking.viewerName }), answer.data.booking.roomError ? 'warn' : 'ok');
    });
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
    var price = b.priceCents == null ? '' : ' · ' + priceText(b.priceCents, b.currency);
    sub.appendChild(make('span', null, who + lengthText(b.minutes) + price));
    sub.appendChild(make('span', 'cd-pill ' + b.state, (T.states && T.states[b.state]) || b.state));
    if (b.paid) sub.appendChild(make('span', 'cd-pill paid', fill(T.paid, { price: priceText(b.paidAmountCents != null ? b.paidAmountCents : b.priceCents, b.paidCurrency || b.currency) })));
    if (b.refundPending) sub.appendChild(make('span', 'cd-pill warn', T.refundPending));
    else if (b.refundState === 'refunded') sub.appendChild(make('span', 'cd-pill paid', T.refunded));
    if (b.outside) sub.appendChild(make('span', 'cd-pill warn', T.outside));
    what.appendChild(sub);
    if (b.state === 'awaiting_payment' && b.payBy) {
      what.appendChild(make('div', 'cd-sub', fill(T.payBy, { when: C.payByLabel(b.payBy, zone, lang) })));
    }
    if (b.note) what.appendChild(make('div', 'cd-note-text', b.note));
    if (b.state === 'cancelled' && b.cancelReason) what.appendChild(make('div', 'cd-note-text', fill(T.reasonGiven, { reason: b.cancelReason })));
    if (b.state === 'rescheduling') what.appendChild(rescheduleBox(b));
    refundBoxes(b, what);
    if (b.messageError) what.appendChild(make('div', 'cd-warn', fill(T.messageError, { name: b.viewerName })));
    if (b.paymentIssue === 'late') {
      what.appendChild(make('div', 'cd-warn', fill(T.paymentLate, { name: b.viewerName, price: priceText(b.paidAmountCents != null ? b.paidAmountCents : b.priceCents, b.paidCurrency || b.currency) })));
    }
    roomParts(b, what, line);
    if (b.transcriptStatus && T.transcript && T.transcript[b.transcriptStatus]) {
      what.appendChild(make('div', b.transcriptStatus === 'sent' ? 'cd-sub' : 'cd-warn', T.transcript[b.transcriptStatus]));
    }
    line.appendChild(what);

    var actions = make('div', 'cd-acts');
    if (b.startsAt > now && b.state === 'waiting') {
      actions.appendChild(iconButton('ok', '✓', T.accept, function () { act(b, 'accept', line); }));
      actions.appendChild(iconButton('no', '✕', T.decline, function () { act(b, 'decline', line); }));
    } else {
      if (b.startsAt > now && b.state === 'confirmed') {
        var move = make('button', 'cd-sbtn plain', T.reschedule);
        move.type = 'button';
        move.addEventListener('click', function () { openReschedule(b, 'start'); });
        actions.appendChild(move);
      }
      if ((b.startsAt > now && (b.state === 'confirmed' || b.state === 'awaiting_payment')) || b.state === 'rescheduling') {
        var cancel = make('button', 'cd-sbtn', T.cancel);
        cancel.type = 'button';
        cancel.addEventListener('click', function () { openCancel(b); });
        actions.appendChild(cancel);
      }
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

  function dateTime(ms) { return C.dateLabel(ms, zone, lang) + ', ' + time(ms); }

  // Where a reschedule stands, written from the booking: who proposed what, when it lapses, when the whole thing closes.
  function rescheduleBox(b) {
    var box = make('div', 'cd-resched');
    var p = b.proposal;
    var name = b.viewerName;
    if (p && p.by === 'coach') box.appendChild(make('p', null, fill(T.reschedCoachProposed, { name: name, when: dateTime(p.startsAt), lapse: p.at ? dateTime(p.at + limits.proposalLapseMs) : '' })));
    else if (p) box.appendChild(make('p', null, fill(T.reschedViewerProposed, { name: name, when: dateTime(p.startsAt) })));
    else box.appendChild(make('p', null, fill(T.reschedWaitingViewer, { name: name })));
    if (p && p.note) box.appendChild(make('p', null, '\u201c' + p.note + '\u201d'));
    if (b.rescheduleEndsAt) box.appendChild(make('p', 'cd-sub', fill(T.reschedEnds, { when: dateTime(b.rescheduleEndsAt) })));
    if (p && p.by === 'viewer') {
      var row = make('div', 'cd-btnrow');
      var accept = make('button', 'cd-sbtn go', T.acceptProposal);
      accept.type = 'button';
      accept.addEventListener('click', function () {
        accept.disabled = true;
        api('POST', '/dashboard/api/coaching/bookings/' + encodeURIComponent(String(b.id)) + '/accept-proposal').then(function (answer) {
          if (!answer.ok) { accept.disabled = false; message('cd-schedule-msg', answer.text); return; }
          var u = answer.data.booking;
          refresh(u);
          if (u.messageError) message('cd-schedule-msg', fill(T.messageError, { name: u.viewerName }), 'warn');
          else message('cd-schedule-msg', fill(T.proposalAccepted, { name: u.viewerName, when: dateTime(u.startsAt) }), 'ok');
        });
      });
      row.appendChild(accept);
      var other = make('button', 'cd-sbtn plain', T.proposeAnother);
      other.type = 'button';
      other.addEventListener('click', function () { openReschedule(b, 'counter'); });
      row.appendChild(other);
      box.appendChild(row);
    }
    return box;
  }

  // The refunds this booking owes: each payment waiting for the coach, with the payer's PayPal details (this page only)
  // and Refunded, which only records what the coach did in PayPal.
  function refundBoxes(b, what) {
    (b.refunds || []).forEach(function (r) {
      if (r.status !== 'pending') return;
      var box = make('div', 'cd-refund');
      box.appendChild(make('b', null, fill(T.refundTitle, { price: priceText(r.amountCents, r.currency) })));
      box.appendChild(make('p', null, r.payerName || r.payerEmail ? fill(T.refundPayer, { name: r.payerName || '-', email: r.payerEmail || '-' }) : T.refundNoPayer));
      if (r.captureId) box.appendChild(make('p', null, fill(T.refundCapture, { id: r.captureId })));
      var row = make('div', 'cd-btnrow');
      var done = make('button', 'cd-sbtn go', T.refundedButton);
      done.type = 'button';
      done.addEventListener('click', function () {
        if (!window.confirm(fill(T.refundConfirm, { name: b.viewerName }))) return;
        done.disabled = true;
        api('POST', '/dashboard/api/coaching/payments/' + encodeURIComponent(r.orderId) + '/refunded').then(function (answer) {
          if (!answer.ok) { done.disabled = false; message('cd-schedule-msg', answer.text); return; }
          if (answer.data.booking) replaceBooking(answer.data.booking);
          drawSchedule();
          message('cd-schedule-msg', fill(T.refundedDone, { name: b.viewerName }), 'ok');
        });
      });
      row.appendChild(done);
      box.appendChild(row);
      what.appendChild(box);
    });
  }

  // Accept, Decline (after asking) or Cancel (after asking); the row is redrawn from the answer, which says whether
  // Atleta could message the viewer.
  function act(b, action, line) {
    if (action === 'decline' && !window.confirm(fill(T.declineConfirm, { name: b.viewerName }))) return;
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

  // ── Pop-ups: Cancel with a reason, Reschedule ──
  // Native <dialog>s: Esc closes, focus stays inside and comes back to the button; a click on the backdrop closes too.

  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-cd-close]'), function (b) {
      b.addEventListener('click', function () { dialog.close(); });
    });
  }
  function counter(input, out, max) {
    var update = function () { out.textContent = input.value.length + ' / ' + max; };
    input.addEventListener('input', update);
    update();
  }
  function dialogMessage(id, text) {
    var box = $(id);
    box.textContent = text || '';
    box.className = 'cd-msg';
    show(box, !!text);
  }

  var cancelDialog = $('cd-cancel-dialog');
  var cancelFor = null;
  closeOnBackdrop(cancelDialog);
  counter($('cd-cancel-reason'), $('cd-cancel-count'), limits.cancelReasonMax);

  function openCancel(b) {
    cancelFor = b;
    $('cd-cancel-title').textContent = fill(T.cancelTitle, { name: b.viewerName });
    show($('cd-cancel-paid'), !!b.paid);
    $('cd-cancel-reason').value = '';
    $('cd-cancel-reason').dispatchEvent(new Event('input'));
    $('cd-cancel-submit').disabled = false;
    dialogMessage('cd-cancel-msg', '');
    cancelDialog.showModal();
    $('cd-cancel-reason').focus();
  }

  $('cd-cancel-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var b = cancelFor;
    if (!b) return;
    var reason = $('cd-cancel-reason').value.trim();
    if (!reason) { dialogMessage('cd-cancel-msg', T.reasonRequired); $('cd-cancel-reason').focus(); return; }
    var submit = $('cd-cancel-submit');
    submit.disabled = true;
    api('POST', '/dashboard/api/coaching/bookings/' + encodeURIComponent(String(b.id)) + '/cancel', { reason: reason }).then(function (answer) {
      submit.disabled = false;
      if (!answer.ok) { dialogMessage('cd-cancel-msg', answer.text); return; }
      var updated = answer.data.booking;
      cancelDialog.close();
      replaceBooking(updated);
      drawSchedule();
      if (updated.messageError) message('cd-schedule-msg', fill(T.messageError, { name: updated.viewerName }), 'warn');
      else message('cd-schedule-msg', fill(T.cancelled, { name: updated.viewerName }), 'ok');
    });
  });

  var reschedDialog = $('cd-resched-dialog');
  var reschedFor = null;
  var reschedMode = 'start';
  var reschedDays = []; // [{ date, starts: [ms] }]
  closeOnBackdrop(reschedDialog);
  counter($('cd-resched-note'), $('cd-resched-count'), limits.noteMax);

  function chosenWay() {
    if (reschedMode === 'counter') return 'propose';
    var checked = reschedDialog.querySelector('input[name="cd-way"]:checked');
    return checked ? checked.value : 'propose';
  }
  function syncWay() {
    show($('cd-resched-pick'), chosenWay() === 'propose');
  }
  Array.prototype.forEach.call(reschedDialog.querySelectorAll('input[name="cd-way"]'), function (r) { r.addEventListener('change', syncWay); });

  function drawTimes() {
    var day = reschedDays[$('cd-resched-day').selectedIndex];
    var select = $('cd-resched-time');
    clear(select);
    (day ? day.starts : []).forEach(function (ms) {
      var option = make('option', null, time(ms));
      option.value = String(ms);
      select.appendChild(option);
    });
  }
  $('cd-resched-day').addEventListener('change', drawTimes);

  function drawStarts(starts) {
    reschedDays = [];
    starts.forEach(function (ms) {
      var date = C.localDate(ms, zone);
      var last = reschedDays[reschedDays.length - 1];
      if (!last || last.date !== date) reschedDays.push(last = { date: date, starts: [] });
      last.starts.push(ms);
    });
    var daySelect = $('cd-resched-day');
    clear(daySelect);
    reschedDays.forEach(function (d) {
      var option = make('option', null, C.dateLabel(d.starts[0], zone, lang));
      option.value = d.date;
      daySelect.appendChild(option);
    });
    drawTimes();
    show($('cd-resched-loading'), false);
    show($('cd-resched-fields'), reschedDays.length > 0);
    if (!reschedDays.length) {
      var loading = $('cd-resched-loading');
      loading.textContent = T.rescheduleNoTimes;
      show(loading, true);
    }
  }

  function openReschedule(b, mode) {
    reschedFor = b;
    reschedMode = mode;
    $('cd-resched-title').textContent = fill(mode === 'counter' ? T.proposeAnotherTitle : T.rescheduleTitle, { name: b.viewerName });
    $('cd-way-ask').textContent = fill(T.rescheduleWayAsk, { name: b.viewerName });
    show($('cd-resched-ways'), mode !== 'counter');
    reschedDialog.querySelector('input[name="cd-way"][value="propose"]').checked = true;
    $('cd-resched-note').value = '';
    $('cd-resched-note').dispatchEvent(new Event('input'));
    $('cd-resched-zone').textContent = fill(T.zone, { zone: zone });
    $('cd-resched-loading').textContent = T.rescheduleLoading;
    show($('cd-resched-loading'), true);
    show($('cd-resched-fields'), false);
    $('cd-resched-submit').disabled = true;
    dialogMessage('cd-resched-msg', '');
    syncWay();
    reschedDialog.showModal();
    api('GET', '/dashboard/api/coaching/bookings/' + encodeURIComponent(String(b.id)) + '/proposal-starts').then(function (answer) {
      if (reschedFor !== b) return;
      $('cd-resched-submit').disabled = false;
      if (!answer.ok) {
        show($('cd-resched-loading'), false);
        dialogMessage('cd-resched-msg', answer.text);
        return;
      }
      drawStarts(answer.data.starts || []);
    });
  }

  $('cd-resched-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var b = reschedFor;
    if (!b) return;
    var way = chosenWay();
    var body = { note: $('cd-resched-note').value.trim() };
    if (way === 'propose') {
      var picked = Number($('cd-resched-time').value);
      if (!picked) { dialogMessage('cd-resched-msg', T.rescheduleNoTimes); return; }
      body.startsAt = picked;
    }
    var url = '/dashboard/api/coaching/bookings/' + encodeURIComponent(String(b.id)) + (reschedMode === 'counter' ? '/propose' : '/reschedule');
    if (reschedMode !== 'counter') body.way = way;
    var submit = $('cd-resched-submit');
    submit.disabled = true;
    api('POST', url, body).then(function (answer) {
      submit.disabled = false;
      if (!answer.ok) { dialogMessage('cd-resched-msg', answer.text); return; }
      var updated = answer.data.booking;
      reschedDialog.close();
      refresh(updated);
      if (updated.messageError) message('cd-schedule-msg', fill(T.messageError, { name: updated.viewerName }), 'warn');
      else message('cd-schedule-msg', fill(reschedMode === 'counter' || way === 'propose' ? T.proposalSent : T.askSent, { name: updated.viewerName }), 'ok');
    });
  });

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

  function drawLengths() {
    var box = $('cd-lengths-list');
    clear(box);
    LENGTH_MINUTES.forEach(function (m) {
      var l = lengths[m];
      var name = lengthText(m);
      var row = make('div', 'cd-lrow' + (l.on ? '' : ' off'));
      var toggle = make('label', 'pill-toggle mini');
      var input = make('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.checked = l.on;
      input.setAttribute('aria-label', name);
      toggle.appendChild(input);
      toggle.appendChild(make('span', 'slider'));
      row.appendChild(toggle);
      row.appendChild(make('span', 'cd-ln', name));
      var price = make('span', 'cd-lp');
      var field = make('input');
      field.type = 'number';
      field.min = '0';
      field.max = '1000';
      field.step = '0.01';
      field.inputMode = 'decimal';
      field.value = (l.price / 100).toFixed(2);
      field.disabled = !l.on;
      field.setAttribute('aria-label', fill(T.priceFor, { length: name, currency: money.currency }));
      price.appendChild(field);
      price.appendChild(make('span', 'cd-cur', money.currency));
      row.appendChild(price);
      input.addEventListener('change', function () {
        l.on = input.checked;
        row.classList.toggle('off', !l.on);
        field.disabled = !l.on;
      });
      field.addEventListener('input', function () {
        var n = Number(field.value);
        l.price = field.value !== '' && isFinite(n) ? Math.round(n * 100) : NaN;
      });
      box.appendChild(row);
    });
  }

  // The category picker: none (no rooms) and the coaching server's categories; a server just picked has none to list
  // until it is saved.
  function drawCategories() {
    var select = $('cd-category');
    var server = $('cd-server');
    var changed = server && settings.guildId && server.value !== settings.guildId;
    clear(select);
    var none = make('option', null, T.categoryNone);
    none.value = '';
    select.appendChild(none);
    if (!changed) {
      categories.forEach(function (c) {
        var option = make('option', null, c.name);
        option.value = c.id;
        select.appendChild(option);
      });
    }
    select.value = !changed && settings.categoryId ? settings.categoryId : '';
    select.disabled = !!changed || !setUp;
    var hint = $('cd-category-hint');
    var base = hint.getAttribute('data-base') || hint.textContent;
    hint.setAttribute('data-base', base);
    hint.textContent = changed || !setUp ? T.categoryAfterSave : (setUp && !categories.length ? T.categoryUnavailable : base);
  }

  function drawMoney() {
    show($('cd-no-paypal'), !money.hasPaypal);
    show($('cd-check-prices'), !!money.checkPrices);
  }

  // The Connections tab's three status lines, from what the page knows (routes/coachingDashboard.js connectionsView):
  // a line is warn unless what it needs is known to be fine. Nothing is known before the first save (Discord) or
  // without the data (an older page in this browser's cache), and a missing line simply says nothing.
  function connStatus(id, ok, okText, warnText) {
    var el = $(id);
    if (!el) return;
    el.textContent = ok ? okText : warnText;
    el.className = 'cd-status' + (ok ? '' : ' warn');
  }
  function drawConnections() {
    var conn = connections || {};
    var discord = conn.discord;
    if (discord) {
      if (discord.botSeen == null) connStatus('cd-conn-discord', false, '', T.statusNotSetUp);
      else connStatus('cd-conn-discord', discord.botSeen && discord.categoryOk !== false && discord.inviteOk !== false, T.connDiscordOk, T.connDiscordWarn);
    }
    var paypal = conn.paypal;
    if (paypal) connStatus('cd-conn-paypal', !!money.hasPaypal, fill(T.connPaypalOn, { email: paypal.email || '' }), T.connPaypalOff);
    var twitch = conn.twitch;
    if (twitch) connStatus('cd-conn-twitch', !!twitch.username, fill(T.connTwitchOk, { name: twitch.username || '' }), T.connTwitchNone);
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
    Array.prototype.forEach.call(document.querySelectorAll('.cd-save'), function (b) { b.textContent = saving ? T.saving : (setUp ? T.save : T.saveFirst); });
    show($('cd-invite-broken'), setUp && settings.inviteOk === false);
    show($('cd-link'), setUp);
    show($('cd-link-hint'), setUp);
    show($('cd-link-later'), !setUp);
  }

  function drawAll() {
    drawStatus();
    drawHours();
    drawDaysOff();
    drawLengths();
    drawCategories();
    drawMoney();
    drawConnections();
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
        formMessage('');
      } else {
        formMessage(answer.text);
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
  if ($('cd-server')) $('cd-server').addEventListener('change', drawCategories);

  // The six lengths as the server reads them: every length, on or off, with its price in whole cents (a price that is
  // not a number goes as null, which the server refuses with its own text).
  function lengthsBody() {
    var out = {};
    LENGTH_MINUTES.forEach(function (m) {
      out[m] = { on: lengths[m].on, price: isNaN(lengths[m].price) ? null : lengths[m].price };
    });
    return out;
  }

  $('cd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (saving) return;
    saving = true;
    var saves = Array.prototype.slice.call(document.querySelectorAll('.cd-save'));
    saves.forEach(function (b) { b.disabled = true; });
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
      lengths: lengthsBody(),
      categoryId: $('cd-category').disabled ? undefined : $('cd-category').value,
    }).then(function (answer) {
      saving = false;
      saves.forEach(function (b) { b.disabled = false; });
      if (!answer.ok) {
        drawStatus();
        if (answer.code && TAB_OF_CODE[answer.code]) openTab(TAB_OF_CODE[answer.code]);
        formMessage(answer.text);
        return;
      }
      var first = !setUp;
      setUp = true;
      settings = answer.data.settings;
      lengths = copyLengths(settings.lengths);
      money = answer.data.money || money;
      connections = answer.data.connections || connections;
      categories = answer.data.categories || categories;
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
      if (outside.length) formMessage(text + ' ' + T.outsideSaved, 'warn');
      else formMessage(text, 'ok');
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

  // The Connections tab's PayPal form: its own save (the page's form above holds the Discord fields). On a refusal the
  // route's text is shown; on a save the money view and the status lines come back and are redrawn.
  var paypalForm = $('cd-paypal-form');
  if (paypalForm) {
    paypalForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var button = $('cd-paypal-save');
      if (button) button.disabled = true;
      api('POST', '/dashboard/api/coaching/paypal', { paypalEmail: $('cd-paypal-email').value }).then(function (answer) {
        if (button) button.disabled = false;
        if (!answer.ok) { message('cd-paypal-msg', answer.text); return; }
        money = answer.data.money || money;
        connections = answer.data.connections || connections;
        $('cd-paypal-email').value = answer.data.email || '';
        drawMoney();
        drawConnections();
        message('cd-paypal-msg', T.saved, 'ok');
      });
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
