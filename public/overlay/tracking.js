// The Tracking sources: the follower and sub goal bars (/overlay/goal/followers/<token>, /overlay/goal/subs/<token>)
// and the six trackers (/overlay/tracker/<tracker>/<token>), each an OBS browser source of its own, and their
// token-less previews (/overlay/goal-demo/tracking, /overlay/tracker-demo), which the dashboard drives with
// same-origin postMessage. The page says what it is in window.TRACKING_PAGE ({ source: 'goal' | 'tracker', tracker,
// events, demo }) and hands over its texts in window.TRACKING_TEXTS, in the language its link names ({{count}} is
// filled in here).
//
// A goal bar is the tip goal's card (goal.css: the same markup and classes, --goal-color), with whole numbers for
// "current / target". A tracker is a compact card in the same style: a small title above, the value below, in the
// tracker's colour. Everything the server sends (titles, viewers' names) is set as text, never as HTML.
//
// Messages, on the stream or posted by the dashboard:
//   { type: 'config', serverVersion, settings? }  a tracker's settings ({ enabled, color }) come with it
//   { type: 'track_goal', goal, added?, justCompleted? }
//   { type: 'tracker', tracker, value }
//   { type: 'tracker_settings', tracker, enabled, color }
(function () {
  'use strict';

  const texts = window.TRACKING_TEXTS || {};
  const page = window.TRACKING_PAGE || {};
  const locale = (document.documentElement && document.documentElement.lang) || 'en';
  const root = document.getElementById('tracking-root');

  const GOAL_COLOR = '#22c55e';
  const TRACKER_COLOR = '#9146FF';
  const TRACKERS = ['latest_follower', 'latest_sub', 'latest_tip', 'latest_raid', 'latest_bits', 'top_tipper'];

  const colorOr = (value, fallback) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function count(n) {
    const value = Math.round(Number(n) || 0);
    try {
      return new Intl.NumberFormat(locale).format(value);
    } catch (e) {
      return String(value);
    }
  }

  function money(amount, currency) {
    const value = Number(amount) || 0;
    try {
      return currency
        ? new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
        : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    } catch (e) {
      return (currency ? currency + ' ' : '') + value.toFixed(2);
    }
  }

  // A text with {{count}}; exactly one takes the singular text when there is one.
  function counted(name, oneName, n) {
    if (Number(n) === 1 && oneName && texts[oneName]) return texts[oneName];
    return String(texts[name] || '').replace(/\{\{count\}\}/g, count(n));
  }

  // Restarts a CSS animation class on an element.
  function replay(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  // ── The goal bar ───────────────────────────────────────────────────────

  let goalId = null;
  let shownCount = 0;
  let countAnim = null;

  function buildGoal(goal) {
    root.textContent = '';
    const card = node('div', 'goal-card');
    const header = node('div', 'goal-header');
    const amounts = node('span', 'goal-amounts');
    amounts.appendChild(node('span', 'goal-current'));
    amounts.appendChild(node('span', 'goal-sep', ' / '));
    amounts.appendChild(node('span', 'goal-target'));
    header.appendChild(node('span', 'goal-title'));
    header.appendChild(amounts);
    const track = node('div', 'goal-track');
    const fill = node('div', 'goal-fill');
    fill.appendChild(node('div', 'goal-shine'));
    track.appendChild(fill);
    track.appendChild(node('div', 'goal-pct'));
    track.appendChild(node('div', 'goal-flag'));
    card.appendChild(node('div', 'goal-accent'));
    card.appendChild(header);
    card.appendChild(track);
    root.appendChild(card);
    goalId = goal.id;
    shownCount = Number(goal.current) || 0;
    return card;
  }

  function stopCount() {
    if (countAnim) cancelAnimationFrame(countAnim);
    countAnim = null;
  }

  // Rolls the shown count up (or down) to `to`, as the tip goal rolls its amount.
  function animateCount(element, to) {
    stopCount();
    const from = shownCount;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 1200);
      const eased = 1 - Math.pow(1 - t, 3);
      shownCount = from + (to - from) * eased;
      element.textContent = count(shownCount);
      if (t < 1) countAnim = requestAnimationFrame(step);
      else { shownCount = to; countAnim = null; }
    };
    countAnim = requestAnimationFrame(step);
  }

  function showIncrement(card, added) {
    replay(card, 'bump');
    const pop = node('div', 'goal-pop', '+' + count(added));
    card.appendChild(pop);
    setTimeout(() => pop.remove(), 2200);
  }

  function celebrate(card, color) {
    card.classList.add('celebrate');
    const colors = ['#ffffff', '#111111', color, '#facc15'];
    for (let i = 0; i < 40; i++) {
      const piece = node('div', 'goal-confetti');
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.4) + 's';
      piece.style.setProperty('--dx', ((Math.random() - 0.5) * 160) + 'px');
      piece.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      card.appendChild(piece);
      setTimeout(() => piece.remove(), 2600);
    }
    setTimeout(() => card.classList.remove('celebrate'), 4000);
  }

  // Draws the goal (the payload of services/trackingGoals.js); null hides the bar. `event` is the message it came
  // with: `added` pops a +N, `justCompleted` celebrates.
  function renderGoal(goal, event) {
    if (!goal) {
      stopCount();
      root.textContent = '';
      goalId = null;
      return;
    }
    let card = root.querySelector('.goal-card');
    if (goal.id !== goalId || !card) card = buildGoal(goal);

    const color = colorOr(goal.barColor, GOAL_COLOR);
    card.style.setProperty('--goal-color', color);
    card.classList.toggle('completed', !!goal.completed);
    const unavailable = goal.unavailable || goal.current === null || goal.current === undefined;
    card.classList.toggle('unavailable', !!unavailable);

    root.querySelector('.goal-title').textContent = (goal.completed ? '🏁 ' : '') + String(goal.title || '');
    const current = root.querySelector('.goal-current');
    const pct = root.querySelector('.goal-pct');
    const fill = root.querySelector('.goal-fill');
    if (unavailable) {
      stopCount();
      current.textContent = texts[goal.unavailable] || '';
      root.querySelector('.goal-target').textContent = '';
      pct.textContent = '';
      fill.style.width = '0%';
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(goal.percent) || 0));
    root.querySelector('.goal-target').textContent = count(goal.target);
    pct.textContent = goal.completed ? (texts.goalReached || '') : Math.floor(percent) + '%';
    fill.style.width = Math.max(percent, goal.current > 0 ? 2 : 0) + '%';
    animateCount(current, Number(goal.current) || 0);

    if (event && Number(event.added) > 0) showIncrement(card, event.added);
    if (event && event.justCompleted) celebrate(card, color);
  }

  // ── A tracker ──────────────────────────────────────────────────────────

  let trackerSettings = { enabled: true, color: TRACKER_COLOR };
  let lastTracker = null; // { tracker, value }: what the last message said, drawn again when the settings change
  let shownKey = null;

  // What the line under the name says for each tracker.
  function detailOf(tracker, value) {
    switch (tracker) {
      case 'latest_sub':
        if (Number(value.gifted) > 0) return counted('gifted', null, value.gifted);
        return Number(value.months) > 0 ? counted('months', 'monthOne', value.months) : '';
      case 'latest_raid': return counted('viewers', 'viewerOne', value.viewers);
      case 'latest_bits': return counted('bits', 'bitOne', value.amount);
      case 'latest_tip':
      case 'top_tipper': return money(value.amount, value.currency);
      default: return '';
    }
  }

  function draw() {
    const shown = lastTracker;
    if (!shown || !trackerSettings.enabled || !TRACKERS.includes(shown.tracker) || !shown.value || !shown.value.name) {
      root.textContent = '';
      shownKey = null;
      return;
    }
    const { tracker, value } = shown;
    let card = root.querySelector('.trk-card');
    if (!card) {
      root.textContent = '';
      card = node('div', 'trk-card');
      const body = node('div', 'trk-value');
      body.appendChild(node('span', 'trk-name'));
      body.appendChild(node('span', 'trk-detail'));
      card.appendChild(node('div', 'trk-accent'));
      card.appendChild(node('div', 'trk-title'));
      card.appendChild(body);
      root.appendChild(card);
    }
    card.style.setProperty('--track-color', trackerSettings.color);
    root.querySelector('.trk-title').textContent = texts[tracker] || '';
    root.querySelector('.trk-name').textContent = String(value.name);
    root.querySelector('.trk-detail').textContent = detailOf(tracker, value);
    const key = tracker + '\n' + JSON.stringify(value);
    if (key !== shownKey) replay(card, 'slide');
    shownKey = key;
  }

  // Draws a tracker's value (services/trackers.js); hidden while it is empty or the tracker is switched off.
  function renderTracker(tracker, value) {
    lastTracker = { tracker, value };
    draw();
  }

  // The tracker's settings: switched off shows nothing, a colour that is not #rrggbb is the Atleta purple.
  function applyTrackerSettings(settings) {
    const s = settings || {};
    trackerSettings = { enabled: s.enabled !== false && s.enabled !== 0, color: colorOr(s.color, TRACKER_COLOR) };
    draw();
  }

  // ── Messages ───────────────────────────────────────────────────────────

  let serverVersion = null;

  function handle(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'config') {
      if (serverVersion && data.serverVersion && data.serverVersion !== serverVersion) {
        location.reload();
        return;
      }
      serverVersion = data.serverVersion || serverVersion;
      if (page.source === 'tracker' && data.settings) applyTrackerSettings(data.settings);
      return;
    }
    if (page.source === 'goal') {
      if (data.type === 'track_goal') renderGoal(data.goal, data);
      return;
    }
    if (page.source === 'tracker') {
      // A source shows its own tracker; a preview, whichever the dashboard posts.
      if (page.tracker && data.tracker !== page.tracker) return;
      if (data.type === 'tracker') renderTracker(data.tracker, data.value);
      else if (data.type === 'tracker_settings') applyTrackerSettings(data);
    }
  }

  let source = null;
  let retryTimer = null;

  function connect() {
    if (source) { source.close(); source = null; }
    source = new EventSource(page.events);
    source.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      handle(data);
    };
    source.onerror = () => {
      if (source) source.close();
      source = null;
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 5000);
    };
  }

  const api = { renderGoal, renderTracker, applyTrackerSettings, handle };
  window.TrackingSource = api;
  if (typeof module === 'object' && module.exports) module.exports = api;

  if (page.demo) {
    // Preview (a dashboard iframe): what to show comes from the parent page, same origin only
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      handle(e.data);
    });
  } else if (page.events) {
    connect();
  }
})();
