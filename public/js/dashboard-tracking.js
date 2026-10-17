'use strict';

// The Tracking card (views/cards/tracking.ejs). The two goal bars are drawn here from the card's data-goals (each with
// Test, its OBS link, Edit and End, or Start a goal), and again from the Tracking routes' answer after a change. Start
// and Edit open the pop-up (template tpl-track-goal): a live preview of the bar on top, the title, the target with
// − / + and quick picks, colour swatches, and for a new goal the period as chips, calendar or rolling, the time zone or
// the hours. The trackers' switches, ▶ (a sample on the source for 10 s) and copy buttons call the Tracking page's
// routes (/dashboard/api/tracking/*). Built on the working cards' page script (window.ATLETA_CARD_UI,
// dashboard-cards.js): its requests, pop-up and messages. Texts: window.ATLETA_CARD_TEXTS.tracking. What a streamer
// typed is set as text. Served as it is (no build step).
(function () {
  const ui = window.ATLETA_CARD_UI;
  const card = document.getElementById('card-tracking');
  if (!ui || !card) return;
  const T = ui.T || {};
  const K = T.tracking || {};
  const { $, $$, core, call } = ui;
  const fill = core.fill;
  const locale = document.documentElement.lang || 'en';
  const KINDS = ['follow', 'sub'];
  const ICONS = { follow: 'i-heart', sub: 'i-star' };
  const SWATCHES = ['#9146ff', '#ff6b9a', '#4fd1ff', '#3ecf8e', '#f7c948'];
  const QUICK = { follow: [50, 100, 500, 1000], sub: [10, 25, 50, 100] };
  const DEFAULT_TARGET = { follow: 100, sub: 50 };
  const PERIODS = ['lifetime', 'year', 'month', 'week', 'day', 'hours'];
  const COUNTED = ['year', 'month', 'week', 'day'];
  const TARGET_MAX = 10000000;
  const HOURS_MAX = 720;

  let goals = {};
  try { goals = JSON.parse(card.dataset.goals || '{}'); } catch (e) { goals = {}; }

  // ── Small helpers ──

  function num(n) {
    try { return new Intl.NumberFormat(locale).format(Number(n) || 0); } catch (e) { return String(Number(n) || 0); }
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function icon(id, small) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', small ? 'i sm' : 'i');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }
  function button(className, text, attrs) {
    const b = el('button', className, text);
    b.type = 'button';
    for (const [name, value] of Object.entries(attrs || {})) b.setAttribute(name, value);
    return b;
  }
  const isColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  // A refusal of the Tracking routes in words (their codes have texts), else what the shared helper says.
  function words(answer) {
    if (answer && answer.kind === 'refused' && answer.error && K.errors && K.errors[answer.error]) return fill(K.errors[answer.error], answer.data || {});
    return answer;
  }
  // A goal's period as the card shows it: All time, 24 h, Monthly · calendar.
  function periodText(goal, hours) {
    if (!goal) return '';
    if (goal.period === 'lifetime') return K.lifetime || '';
    if (goal.period === 'hours') return fill(K.hours, { count: num(hours || goal.hours || 0) });
    const name = K[goal.period] || '';
    return goal.mode ? name + ' · ' + (K[goal.mode] || goal.mode) : name;
  }
  function countText(goal) {
    if (goal.unavailable === 'needs_reconnect') return K.reconnect;
    if (goal.unavailable) return K.notAvailable;
    const params = { current: num(goal.current), target: num(goal.target) };
    return fill(goal.completed ? K.reached : K.running, params);
  }
  function flash(target) {
    target.classList.add('done');
    setTimeout(() => target.classList.remove('done'), 1500);
  }

  // ── The goal bars ──

  function renderGoals() {
    for (const kind of KINDS) {
      const box = $('[data-goal="' + kind + '"]', card);
      if (!box) continue;
      const entry = goals[kind] || {};
      const goal = entry.goal;
      box.replaceChildren();
      box.style.removeProperty('--bar');
      const copy = entry.url ? button('wc-ib', null, { 'data-track-copy': entry.url, title: K.copyLink, 'aria-label': K.copyLink + ': ' + K.kindTitle[kind] }) : null;
      if (copy) copy.appendChild(icon('i-copy', true));
      if (!goal) {
        box.className = 'wc-tgoal empty';
        box.appendChild(el('span', 'nm', K.kindTitle[kind]));
        const acts = el('span', 'acts');
        if (copy) acts.appendChild(copy);
        const start = button('btn btn-primary wc-btn xs', null, { 'data-goal-start': kind });
        start.append(icon('i-plus', true), document.createTextNode(K.startGoal));
        acts.appendChild(start);
        box.appendChild(acts);
        continue;
      }
      box.className = 'wc-tgoal' + (goal.completed ? ' reached' : '');
      if (isColor(goal.barColor)) box.style.setProperty('--bar', goal.barColor);
      // The title, then which goal and its period; the bar; the count, then Test, the link, Edit and End.
      const top = el('div', 'top');
      top.append(el('b', 'tt', goal.title), el('small', null, K.kindTitle[kind] + ' · ' + periodText(goal, entry.hours)));
      const bar = el('div', 'bar');
      const fillBar = el('i');
      fillBar.style.width = goal.unavailable ? '0%' : Math.max(0, Math.min(100, Number(goal.percent) || 0)) + '%';
      bar.appendChild(fillBar);
      const bottom = el('div', 'bot');
      const acts = el('span', 'acts');
      const test = button('btn btn-secondary wc-btn xs', null, { 'data-goal-test': kind, title: K.testGoal });
      test.append(icon('i-play', true), document.createTextNode(K.test));
      acts.appendChild(test);
      if (copy) acts.appendChild(copy);
      const edit = button('wc-ib', null, { 'data-goal-edit': kind, title: K.editGoal, 'aria-label': K.editGoal + ': ' + K.kindTitle[kind] });
      edit.appendChild(icon('i-pen', true));
      acts.append(edit, button('btn btn-secondary wc-btn xs wc-danger', K.endGoal, { 'data-goal-end': kind }));
      bottom.append(el('b', goal.unavailable ? 'count long' : 'count', countText(goal)), acts);
      box.append(top, bar, bottom);
    }
    ui.repack();
  }

  // After a Tracking route answered with its state: the goals again (keeping their links).
  function takeState(state) {
    if (!state || !state.goals) return;
    for (const kind of KINDS) {
      const next = state.goals[kind] || {};
      goals[kind] = { ...(goals[kind] || {}), goal: next.goal || null, hours: next.hours || null, timeZone: next.timeZone || null };
    }
    renderGoals();
  }

  // ── Buttons ──

  ui.onClick('[data-goal-test]', async (b) => {
    b.disabled = true;
    const answer = await call('POST', '/dashboard/api/tracking/goal/' + b.dataset.goalTest + '/test', { test: 'reach' });
    b.disabled = false;
    if (!answer.ok) return ui.showMessage(card, words(answer));
    ui.clearMessage(card);
    flash(b);
    ui.announce(K.tested);
  });
  ui.onClick('[data-tracker-test]', async (b) => {
    const answer = await call('POST', '/dashboard/api/tracking/tracker/' + b.dataset.trackerTest + '/test', {});
    if (!answer.ok) return ui.showMessage(card, words(answer));
    ui.clearMessage(card);
    flash(b);
    ui.announce(K.tested);
  });
  ui.onClick('[data-track-copy]', async (b) => {
    let done = false;
    try {
      await navigator.clipboard.writeText(b.dataset.trackCopy);
      done = true;
    } catch (e) {
      done = false;
    }
    if (done) flash(b);
    ui.announce(done ? T.copied : T.copyFailed);
    if (!done) ui.showMessage(card, T.copyFailed);
  });
  ui.onClick('[data-goal-end]', async (b) => {
    if (!window.confirm(K.endConfirm)) return;
    b.disabled = true;
    const answer = await call('POST', '/dashboard/api/tracking/goal/' + b.dataset.goalEnd + '/end', {});
    b.disabled = false;
    if (!answer.ok) return ui.showMessage(card, words(answer));
    ui.clearMessage(card);
    takeState(answer.data.state);
    ui.showSaved(card);
    ui.refreshSoon();
  });
  ui.onClick('[data-goal-start]', (b) => openGoal(b.dataset.goalStart, b, false));
  ui.onClick('[data-goal-edit]', (b) => openGoal(b.dataset.goalEdit, b, true));

  // ── The trackers' switches ──

  card.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-tracker-switch]');
    if (!input) return;
    const on = input.checked;
    const row = input.closest('.wc-row');
    if (row) row.classList.toggle('is-off', !on);
    input.disabled = true;
    const answer = await call('POST', '/dashboard/api/tracking/tracker/' + input.dataset.trackerSwitch, { enabled: on });
    input.disabled = false;
    if (!answer.ok) {
      input.checked = !on;
      if (row) row.classList.toggle('is-off', on);
      return ui.showMessage(card, words(answer));
    }
    ui.clearMessage(card);
    ui.showSaved(card);
    ui.refreshSoon();
  });

  // ── The goal pop-up ──

  function timeZones() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
    if (!zones.includes('UTC')) zones = ['UTC'].concat(zones);
    return zones;
  }
  function browserZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  function openGoal(kind, from, editing) {
    if (!KINDS.includes(kind)) return;
    const entry = goals[kind] || {};
    const current = editing ? entry.goal : null;
    if (editing && !current) return;
    const state = {
      color: current && isColor(current.barColor) ? current.barColor.toLowerCase() : SWATCHES[0],
      period: 'month',
      mode: 'calendar',
    };
    ui.openEditor('tpl-track-goal', editing ? K.editTitle[kind] : K.startTitle[kind], from, (editor) => {
      $('[data-tg-icon]', editor).appendChild(icon(ICONS[kind]));
      $('[data-tg-icon]', editor).classList.add(kind);
      $('[data-tg-intro]', editor).textContent = K.intro[kind];
      $('[data-save]', editor).textContent = editing ? K.save : K.start;
      const title = $('[data-field="title"]', editor);
      const target = $('[data-field="target"]', editor);
      const hours = $('[data-field="hours"]', editor);
      const zone = $('[data-field="timeZone"]', editor);
      title.placeholder = K.placeholder[kind];
      title.value = current ? current.title : '';
      target.value = String(current ? current.target : DEFAULT_TARGET[kind]);
      hours.value = '24';

      const preview = () => {
        const n = Math.min(TARGET_MAX, Math.max(1, Math.floor(Number(target.value)) || 1));
        const shown = current ? Math.min(n, Number(current.current) || 0) : Math.round(n * 0.34);
        $('[data-tg-preview]', editor).style.setProperty('--bar', state.color);
        $('[data-tg-ptitle]', editor).textContent = title.value.trim() || K.kindTitle[kind];
        $('[data-tg-pcount]', editor).textContent = num(shown) + ' / ' + num(n);
        $('[data-tg-pfill]', editor).style.width = Math.min(100, (shown / n) * 100) + '%';
        const goal = current || { period: state.period, mode: COUNTED.includes(state.period) ? state.mode : null };
        $('[data-tg-pperiod]', editor).textContent = periodText(goal, current ? entry.hours : hours.value);
      };

      // Target: − / + and quick picks
      $$('[data-tg-step]', editor).forEach((b) => b.addEventListener('click', () => {
        const n = (Math.floor(Number(target.value)) || 0) + Number(b.dataset.tgStep);
        target.value = String(Math.min(TARGET_MAX, Math.max(1, n)));
        preview();
      }));
      const quick = $('[data-tg-quick]', editor);
      for (const n of QUICK[kind]) {
        const b = button(null, num(n));
        b.addEventListener('click', () => { target.value = String(n); preview(); });
        quick.appendChild(b);
      }

      // Colour: five swatches and any colour
      const swatches = $('[data-tg-swatches]', editor);
      const other = el('input');
      other.type = 'color';
      other.className = 'other';
      other.title = K.otherColor;
      other.setAttribute('aria-label', K.otherColor);
      const markColor = () => {
        $$('[data-color]', swatches).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === state.color)));
        other.classList.toggle('on', !SWATCHES.includes(state.color));
        other.value = state.color;
      };
      for (const color of SWATCHES) {
        const b = button(null, null, { role: 'radio', 'data-color': color, 'aria-label': color });
        b.style.background = color;
        b.addEventListener('click', () => { state.color = color; markColor(); preview(); });
        swatches.appendChild(b);
      }
      other.addEventListener('input', () => { if (isColor(other.value)) { state.color = other.value.toLowerCase(); markColor(); preview(); } });
      swatches.appendChild(other);
      markColor();

      // Period, calendar or rolling, time zone, hours (a new goal only)
      const periodBox = $('[data-tg-periods]', editor);
      const showRows = () => {
        const counted = COUNTED.includes(state.period);
        $$('[data-tg-period]', periodBox).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tgPeriod === state.period)));
        $$('[data-tg-mode]', editor).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tgMode === state.mode)));
        $('[data-tg-hours-row]', editor).hidden = editing || state.period !== 'hours';
        $('[data-tg-mode-row]', editor).hidden = editing || !counted;
        $('[data-tg-zone-row]', editor).hidden = state.mode !== 'calendar';
        $('[data-tg-subhint]', editor).hidden = editing || kind !== 'sub' || state.period === 'lifetime';
        preview();
      };
      if (editing) {
        $('[data-tg-new]', editor).hidden = true;
      } else {
        for (const period of PERIODS) {
          const b = button('chip', period === 'hours' ? K.hoursChip : K[period], { 'data-tg-period': period });
          b.addEventListener('click', () => { state.period = period; showRows(); });
          periodBox.appendChild(b);
        }
        $$('[data-tg-mode]', editor).forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.tgMode; showRows(); }));
        const here = browserZone();
        for (const name of timeZones()) {
          const option = el('option', null, name);
          option.value = name;
          if (name === here) option.selected = true;
          zone.appendChild(option);
        }
      }
      [title, target, hours].forEach((input) => input.addEventListener('input', preview));
      showRows();
    }, async (editor) => {
      // An empty title is the goal's own name, as the preview shows it.
      const title = $('[data-field="title"]', editor).value.trim() || K.kindTitle[kind];
      const target = Number($('[data-field="target"]', editor).value);
      let answer;
      if (editing) {
        answer = await call('PATCH', '/dashboard/api/tracking/goal/' + kind, { title, target, barColor: state.color });
      } else {
        const body = { title, target, barColor: state.color, period: state.period };
        if (COUNTED.includes(state.period)) {
          body.mode = state.mode;
          if (state.mode === 'calendar') body.timeZone = $('[data-field="timeZone"]', editor).value;
        }
        if (state.period === 'hours') body.hours = Math.min(HOURS_MAX, Math.floor(Number($('[data-field="hours"]', editor).value)) || 0);
        answer = await call('POST', '/dashboard/api/tracking/goal/' + kind, body);
      }
      if (!answer.ok) {
        ui.dialogMessage(editor, words(answer));
        return false;
      }
      takeState(answer.data.state);
      ui.clearMessage(card);
      ui.showSaved(card);
      ui.refreshSoon();
      return true;
    });
  }

  renderGoals();
})();
