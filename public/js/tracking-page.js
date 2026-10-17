// The Tracking page (views/tracking.ejs): the follower and sub goal cards and the six tracker cards. What they show
// comes from window.TRACKING_DATA.state (routes/dashboard.js trackingState) and is redrawn from each answer of the
// JSON routes under /dashboard/api/tracking/ ({ ok: true, state } or { ok: false, error: <code> }), and every 30 s
// while the tab is shown. The previews are the token-less OBS demos (/overlay/goal-demo/tracking and
// /overlay/tracker-demo, public/overlay/tracking.js), told what to draw with same-origin postMessage: a running goal
// as it is, else what the start form says; a tracker's value, else a sample. Its texts come from
// window.TRACKING_TEXTS (T), the refusals' under T.errors by code. Every text and name goes in with textContent.
(function () {
  'use strict';

  var DATA = window.TRACKING_DATA || {};
  var T = window.TRACKING_TEXTS || {};
  var state = DATA.state;
  var lang = DATA.lang || 'en';
  var TEST_MS = 10000;
  var REQUEST_MS = 20000;
  var REFRESH_MS = 30000;
  if (!state) return;

  var PERIOD_TEXTS = {
    lifetime: T.periodLifetime, year: T.periodYear, month: T.periodMonth, week: T.periodWeek, day: T.periodDay,
  };
  var MODE_TEXTS = { calendar: T.modeCalendar, rolling: T.modeRolling };

  function fill(text, values) {
    return String(text == null ? '' : text).replace(/\{\{(\w+)\}\}/g, function (_, k) { return values && values[k] != null ? values[k] : ''; });
  }
  var numberFormat = (function () { try { return new Intl.NumberFormat(lang); } catch (e) { return new Intl.NumberFormat('en'); } })();
  // Dates in the page's language; a calendar goal's past periods in the goal's own time zone (one formatter per zone).
  var dateFormats = {};
  function dateFormat(timeZone) {
    var key = timeZone || '';
    if (!dateFormats[key]) {
      try { dateFormats[key] = new Intl.DateTimeFormat(lang, timeZone ? { dateStyle: 'medium', timeZone: timeZone } : { dateStyle: 'medium' }); } catch (e) {
        try { dateFormats[key] = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }); } catch (e2) { dateFormats[key] = new Intl.DateTimeFormat('en'); }
      }
    }
    return dateFormats[key];
  }
  function num(n) { return numberFormat.format(Number(n) || 0); }
  function day(iso, timeZone) {
    var d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? dateFormat(timeZone).format(d) : '';
  }
  function $(root, sel) { return root.querySelector(sel); }
  function $$(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function show(el, on) { if (el) el.hidden = !on; }

  // ── Requests ──
  // A redirect (to sign in, which leads off the site) or a 401/403 answer (a CSRF refusal included) means the session
  // ended and the page must be reloaded; an answer that is not JSON did not work; no answer in 20 s counts as no
  // network.
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
        if (json && json.ok) return json;
        return { ok: false, error: json && json.error, text: refusalText(json) };
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
  function refusalText(json) {
    var text = json && json.error && T.errors && T.errors[json.error];
    return text ? fill(text, { seconds: json.seconds }) : T.failed;
  }

  function message(card, text, ok) {
    var box = $(card, '[data-msg]');
    if (!box) return;
    clearTimeout(box._timer);
    box.textContent = text || '';
    box.classList.toggle('ok', !!ok);
    box.hidden = !text;
    if (ok && text) box._timer = setTimeout(function () { box.hidden = true; }, 2500);
  }
  function setStatus(card, text, tone) {
    var el = $(card, '[data-status]');
    el.textContent = text;
    el.classList.toggle('off', tone === 'off');
    el.classList.toggle('warn', tone === 'warn');
  }

  // ── Previews ──
  // Each iframe keeps the last messages for it, sent again when it (re)loads.
  function post(frame, msg) {
    if (!frame) return;
    frame._last = frame._last || [];
    frame._last.push(msg);
    if (frame._last.length > 2) frame._last.shift();
    if (frame._loaded && frame.contentWindow) frame.contentWindow.postMessage(msg, location.origin);
  }
  $$(document, 'iframe[data-preview]').forEach(function (frame) {
    // A preview that loaded before this script ran already listens (its script is window.TrackingSource).
    try { if (frame.contentWindow && frame.contentWindow.TrackingSource) frame._loaded = true; } catch (e) { /* not loaded yet */ }
    frame.addEventListener('load', function () {
      frame._loaded = true;
      (frame._last || []).forEach(function (msg) { frame.contentWindow.postMessage(msg, location.origin); });
    });
  });

  // ── Goals ──

  var goalCards = {};
  $$(document, '[data-kind]').forEach(function (card) { goalCards[card.getAttribute('data-kind')] = card; });

  function periodText(period, hours) {
    if (period === 'hours') return fill(T.periodHours, { count: num(hours) });
    return PERIOD_TEXTS[period] || '';
  }

  // What the start form would start, drawn as a bar with nothing counted yet.
  function formGoal(kind, card) {
    var f = $(card, '[data-start]').elements;
    var target = parseInt(f.target.value, 10) || parseInt(f.target.placeholder, 10) || 100;
    return {
      id: 'demo-' + kind, kind: kind, title: f.title.value.trim() || f.title.placeholder, current: 0, target: target,
      percent: 0, completed: false, barColor: f.color.value, period: f.period.value, mode: null, unavailable: null, capped: false,
    };
  }

  function previewGoal(kind) {
    var card = goalCards[kind];
    if (card._testing) return;
    var goal = state.goals[kind].goal;
    post($(card, '[data-preview]'), { type: 'track_goal', goal: goal || formGoal(kind, card) });
  }

  function syncFormRows(card) {
    var f = $(card, '[data-start]').elements;
    var period = f.period.value;
    var counted = period !== 'lifetime' && period !== 'hours';
    show($(card, '[data-row="mode"]'), counted);
    show($(card, '[data-row="hours"]'), period === 'hours');
    show($(card, '[data-row="zone"]'), counted && f.mode.value === 'calendar');
  }

  function renderHistory(card, rows) {
    var list = $(card, '[data-history]');
    list.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.className = 'when';
      empty.textContent = T.pastEmpty;
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      var result = row.result || (row.reached ? 'reached' : 'missed');
      name.textContent = (result === 'reached' ? '🏁 ' : '') + row.title;
      var right = document.createElement('span');
      right.className = 'when';
      var count = row.count == null ? fill(T.pastTarget, { target: num(row.target) }) : fill(T.pastCount, { count: num(row.count), target: num(row.target) });
      // A period's end is its last moment (the server takes 1 ms off the next period's start): its last day shows.
      var when = [day(row.start, row.timeZone), day(row.end, row.timeZone)].filter(Boolean).join(' – ');
      right.textContent = count + ' · ' + when + ' · ';
      var badge = document.createElement('span');
      badge.className = result === 'reached' ? 'hit' : 'miss';
      badge.textContent = result === 'reached' ? T.pastReached : (result === 'ended' ? T.pastEnded : T.pastMissed);
      right.appendChild(badge);
      li.appendChild(name);
      li.appendChild(right);
      list.appendChild(li);
    });
  }

  function renderGoal(kind, refill) {
    var card = goalCards[kind];
    var g = state.goals[kind];
    var goal = g.goal;
    if (!goal) setStatus(card, T.statusNone, 'off');
    else if (goal.unavailable === 'needs_reconnect') setStatus(card, T.statusReconnect, 'warn');
    else if (goal.unavailable) setStatus(card, T.statusNotAvailable, 'warn');
    else setStatus(card, fill(goal.completed ? T.statusReached : T.statusRunning, { current: num(goal.current), target: num(goal.target) }), 'ok');

    show($(card, '[data-active]'), !!goal);
    show($(card, '[data-start]'), !goal);
    show($(card, '[data-note="reconnect"]'), !!goal && goal.unavailable === 'needs_reconnect');
    show($(card, '[data-note="capped"]'), !!goal && !!goal.capped);
    show($(card, '[data-note="notAffiliate"]'), state.notAffiliate || (!!goal && goal.unavailable === 'not_affiliate'));
    var period = goal ? goal.period : $(card, '[data-start]').elements.period.value;
    show($(card, '[data-note="silent"]'), period !== 'lifetime');

    if (goal) {
      var parts = [periodText(goal.period, g.hours)];
      if (goal.mode) parts.push(MODE_TEXTS[goal.mode]);
      if (goal.mode === 'calendar' && g.timeZone) parts.push(g.timeZone);
      $(card, '[data-summary]').textContent = parts.filter(Boolean).join(' · ');
      var edit = $(card, '[data-edit]').elements;
      if (refill || card._goalId !== goal.id) {
        edit.title.value = goal.title;
        edit.target.value = goal.target;
        edit.color.value = goal.barColor;
      }
      card._goalId = goal.id;
    } else {
      card._goalId = null;
      syncFormRows(card);
    }
    renderHistory(card, g.history || []);
    previewGoal(kind);
  }

  function busy(card, on) {
    $$(card, 'button').forEach(function (b) { b.disabled = on; });
  }

  // Sends one change and redraws the page from the answer; a refusal shows its text on the card. Only the acting goal
  // card's edit form is refilled from the answer (the other one may hold an edit not saved yet).
  function act(card, method, url, body, okText) {
    busy(card, true);
    return api(method, url, body).then(function (answer) {
      busy(card, false);
      if (!answer.ok) { message(card, answer.text); return false; }
      if (answer.state) {
        state = answer.state;
        card._goalId = null;
        renderAll(false);
      }
      message(card, okText || '', !!okText);
      return true;
    });
  }

  function goalUrl(kind, rest) { return '/dashboard/api/tracking/goal/' + kind + (rest || ''); }

  // The test buttons: the preview draws the message the live bar got (the route answers with it), for as long as the
  // live bar shows it.
  function runTest(kind, test) {
    var card = goalCards[kind];
    var note = $(card, '[data-test-status]');
    if (note._default == null) note._default = note.textContent;
    clearTimeout(card._testTimer);
    clearInterval(card._testTick);
    if (test === 'reset') {
      card._testing = false;
      note.textContent = note._default;
      previewGoal(kind);
      api('POST', goalUrl(kind, '/test'), { test: 'reset' }).then(function (answer) { if (!answer.ok) message(card, answer.text); });
      return;
    }
    api('POST', goalUrl(kind, '/test'), { test: test }).then(function (answer) {
      if (!answer.ok) { message(card, answer.text); return; }
      message(card, '');
      if (!answer.message) return;
      card._testing = true;
      post($(card, '[data-preview]'), answer.message);
      var testMs = Number(answer.revertMs) > 0 ? Number(answer.revertMs) : TEST_MS;
      var left = Math.round(testMs / 1000);
      note.textContent = fill(T.testing, { seconds: left });
      card._testTick = setInterval(function () {
        left -= 1;
        if (left > 0) note.textContent = fill(T.testing, { seconds: left });
      }, 1000);
      card._testTimer = setTimeout(function () {
        clearInterval(card._testTick);
        card._testing = false;
        note.textContent = note._default;
        previewGoal(kind);
      }, testMs);
    });
  }

  function wireGoal(kind) {
    var card = goalCards[kind];
    var start = $(card, '[data-start]');
    var zone = start.elements.timeZone;
    try { zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || zone.value; } catch (e) { /* keeps UTC */ }

    start.addEventListener('input', function () { renderGoal(kind); });
    start.addEventListener('change', function () { renderGoal(kind); });
    start.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = start.elements;
      act(card, 'POST', goalUrl(kind), {
        title: f.title.value, target: Number(f.target.value), barColor: f.color.value, period: f.period.value,
        mode: f.mode.value, hours: Number(f.hours.value), timeZone: f.timeZone.value.trim(),
      }, T.saved);
    });

    var edit = $(card, '[data-edit]');
    edit.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = edit.elements;
      act(card, 'PATCH', goalUrl(kind), { title: f.title.value, target: Number(f.target.value), barColor: f.color.value }, T.saved);
    });

    $$(card, '[data-nudge]').forEach(function (b) {
      b.addEventListener('click', function () { act(card, 'POST', goalUrl(kind, '/nudge'), { delta: Number(b.getAttribute('data-nudge')) }); });
    });
    var amount = $(card, '[data-nudge-amount]');
    $(card, '[data-nudge-apply]').addEventListener('click', function () {
      act(card, 'POST', goalUrl(kind, '/nudge'), { delta: Number(amount.value) }).then(function (done) { if (done) amount.value = ''; });
    });
    $(card, '[data-end]').addEventListener('click', function () {
      if (window.confirm(T.endConfirm)) act(card, 'POST', goalUrl(kind, '/end'));
    });
    $$(card, '[data-test]').forEach(function (b) {
      b.addEventListener('click', function () { runTest(kind, b.getAttribute('data-test')); });
    });
  }

  // ── Trackers ──

  var trackerCards = {};
  $$(document, '[data-tracker]').forEach(function (card) { trackerCards[card.getAttribute('data-tracker')] = card; });

  function sample(tracker) {
    var name = T.sampleName;
    switch (tracker) {
      case 'latest_sub': return { name: name, months: 3, tier: '1' };
      case 'latest_tip': return { name: name, amount: 5, currency: state.currency };
      case 'top_tipper': return { name: name, amount: 20, currency: state.currency };
      case 'latest_raid': return { name: name, viewers: 12 };
      case 'latest_bits': return { name: name, amount: 100 };
      default: return { name: name };
    }
  }

  // The preview always draws the tracker (switched off it only hides on stream), in the colour shown; Latest sub on a
  // channel that is not an Affiliate shows what its OBS source shows.
  function previewTracker(tracker, color) {
    var card = trackerCards[tracker];
    var tr = state.trackers[tracker];
    var frame = $(card, '[data-preview]');
    post(frame, { type: 'tracker_settings', tracker: tracker, enabled: true, color: color || tr.color });
    var msg = { type: 'tracker', tracker: tracker, value: tr.value || sample(tracker) };
    if (tracker === 'latest_sub' && state.notAffiliate) msg.unavailable = 'not_affiliate';
    post(frame, msg);
  }

  function renderTracker(tracker, force) {
    var card = trackerCards[tracker];
    var tr = state.trackers[tracker];
    if (!tr.enabled) setStatus(card, T.trackerOff, 'off');
    else if (tr.value && tr.value.name) setStatus(card, fill(T.trackerShows, { name: tr.value.name }), 'ok');
    else setStatus(card, T.trackerNothing, 'off');
    // A switch or colour the streamer is using (focused, or with a save under way) is left as it is, unless a refused
    // save puts it back (`force`).
    var toggle = $(card, '[data-enabled]');
    var color = $(card, '[data-color]');
    if (force || (!card._saving && document.activeElement !== toggle)) toggle.checked = !!tr.enabled;
    if (force || (!card._saving && document.activeElement !== color)) color.value = tr.color;
    show($(card, '[data-color-reset]'), !!tr.ownColor);
    show($(card, '[data-note="notAffiliate"]'), state.notAffiliate);
    previewTracker(tracker);
  }

  // One save at a time per tracker: its switch, colour and reset are disabled until the answer is in, so an older
  // answer can never land after a newer change. A refusal flips the inputs back to what is stored.
  function saveTracker(tracker, change) {
    var card = trackerCards[tracker];
    var inputs = $$(card, '[data-enabled], [data-color], [data-color-reset]');
    card._saving = true;
    inputs.forEach(function (el) { el.disabled = true; });
    return api('POST', '/dashboard/api/tracking/tracker/' + tracker, change).then(function (answer) {
      card._saving = false;
      inputs.forEach(function (el) { el.disabled = false; });
      if (!answer.ok) {
        message(card, answer.text);
        renderTracker(tracker, true);
        return;
      }
      state = answer.state;
      renderAll(false);
      message(card, T.saved, true);
    });
  }

  function wireTracker(tracker) {
    var card = trackerCards[tracker];
    var toggle = $(card, '[data-enabled]');
    toggle.addEventListener('change', function () { saveTracker(tracker, { enabled: toggle.checked }); });
    var color = $(card, '[data-color]');
    color.addEventListener('input', function () { previewTracker(tracker, color.value); });
    color.addEventListener('change', function () { saveTracker(tracker, { color: color.value }); });
    $(card, '[data-color-reset]').addEventListener('click', function () { saveTracker(tracker, { color: null }); });
  }

  // ── The page ──

  function renderAll(refill) {
    Object.keys(goalCards).forEach(function (kind) { renderGoal(kind, refill); });
    Object.keys(trackerCards).forEach(function (tracker) { renderTracker(tracker, false); });
  }

  $$(document, '[data-copy]').forEach(function (b) {
    var label = b.textContent;
    b.addEventListener('click', function () {
      var input = b.parentNode.querySelector('[data-link]');
      if (!input) return;
      var done = function () { b.textContent = T.copied; setTimeout(function () { b.textContent = label; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
      else { input.select(); done(); }
    });
  });

  (function fillZones() {
    var list = document.getElementById('tracking-zones');
    var zones = [];
    try { zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []; } catch (e) { zones = []; }
    zones.forEach(function (z) {
      var option = document.createElement('option');
      option.value = z;
      list.appendChild(option);
    });
  })();

  Object.keys(goalCards).forEach(wireGoal);
  Object.keys(trackerCards).forEach(wireTracker);
  renderAll(true);

  setInterval(function () {
    if (document.hidden) return;
    api('GET', '/dashboard/api/tracking/state').then(function (answer) {
      if (answer.ok && answer.state) { state = answer.state; renderAll(false); }
    });
  }, REFRESH_MS);
})();
