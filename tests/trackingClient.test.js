'use strict';

// The Tracking sources' page script (public/overlay/tracking.js), run in a vm context with a small stand-in for the
// browser: a tiny element tree, an EventSource the test feeds, and timers that never fire on their own. What is
// checked is what the goal bar and the trackers draw from what the server sends, and that everything a viewer or the
// streamer typed reaches the page as text only. Synthetic values only.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'tracking.js'), 'utf8');

const TEXTS = {
  latest_follower: 'Latest follower', latest_sub: 'Latest sub', latest_tip: 'Latest tip', latest_raid: 'Latest raid',
  latest_bits: 'Latest bits', top_tipper: 'Top tipper',
  months: '{{count}} months', monthOne: '1 month', gifted: 'Gifted {{count}}', viewers: '{{count}} viewers', viewerOne: '1 viewer',
  bits: '{{count}} bits', bitOne: '1 bit',
  needs_reconnect: 'Reconnect Twitch on the dashboard', not_affiliate: 'Not available for this channel', goalReached: 'GOAL REACHED!',
};

// ── A small browser ──────────────────────────────────────────────────────

function makeElement(tagName) {
  const properties = {};
  const element = {
    tagName: String(tagName).toUpperCase(), id: '', children: [], parentNode: null, _classes: new Set(), _text: '',
    style: { properties, setProperty(name, value) { properties[name] = String(value); } },
    get className() { return [...this._classes].join(' '); },
    set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
    classList: {
      add: (...names) => names.forEach((n) => element._classes.add(n)),
      remove: (...names) => names.forEach((n) => element._classes.delete(n)),
      contains: (name) => element._classes.has(name),
      toggle: (name, force) => { const on = force === undefined ? !element._classes.has(name) : !!force; if (on) element._classes.add(name); else element._classes.delete(name); return on; },
    },
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; },
    set textContent(value) { this._text = value == null ? '' : String(value); this.children.forEach((c) => { c.parentNode = null; }); this.children = []; },
    get innerHTML() { throw new Error('the script must not read or write HTML'); },
    set innerHTML(value) { throw new Error('the script must not read or write HTML'); },
    appendChild(child) { child.parentNode = element; element.children.push(child); return child; },
    remove() { if (element.parentNode) element.parentNode.children = element.parentNode.children.filter((c) => c !== element); element.parentNode = null; },
    get offsetWidth() { return 100; },
    querySelectorAll(selector) {
      const name = selector.replace(/^\./, '');
      const found = [];
      const walk = (node) => node.children.forEach((child) => { if (child._classes.has(name)) found.push(child); walk(child); });
      walk(element);
      return found;
    },
    querySelector(selector) { return element.querySelectorAll(selector)[0] || null; },
  };
  return element;
}

// Everything under `node`, depth first.
function allElements(node) {
  return node.children.flatMap((child) => [child, ...allElements(child)]);
}

// heldFrames: animation frames wait in `frames` until the test runs them (otherwise each runs at once, at its end).
function loadTracking({ page = {}, texts = TEXTS, lang = 'en', heldFrames = false } = {}) {
  const frames = [];
  const root = makeElement('div');
  root.id = 'tracking-root';
  const listeners = {};
  const sources = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
    send(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const window = {
    TRACKING_TEXTS: texts,
    TRACKING_PAGE: page,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const reloads = [];
  const context = {
    window,
    document: {
      documentElement: { lang },
      getElementById: (id) => (id === 'tracking-root' ? root : null),
      createElement: makeElement,
    },
    location: { origin: 'https://atleta.example', reload() { reloads.push(1); } },
    EventSource: FakeEventSource,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { if (heldFrames) frames.push(fn); else fn(1e9); return 1; },
    cancelAnimationFrame: () => {},
    performance: { now: () => 0 },
    Intl,
    module: { exports: {} },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'tracking.js' });
  const post = (data, origin = 'https://atleta.example') => (listeners.message || []).forEach((fn) => fn({ origin, data }));
  return { api: context.module.exports, browserApi: window.TrackingSource, root, sources, post, reloads, frames };
}

const goal = (over = {}) => ({
  id: 7, kind: 'follow', title: 'Road to 20', current: 7, target: 20, percent: 35, completed: false, barColor: '#3366ff',
  period: 'lifetime', mode: null, unavailable: null, capped: false, ...over,
});
const find = (root, name) => root.querySelector(`.${name}`);
const confetti = (root) => root.querySelectorAll('.goal-confetti').length;

describe('the goal bar', () => {
  test('the tip goal\'s card in the goal\'s colour: its title, current / target and the percent', () => {
    const { api, root } = loadTracking();
    api.renderGoal(goal());
    const card = find(root, 'goal-card');
    assert.ok(card, 'the card is drawn');
    for (const part of ['goal-accent', 'goal-header', 'goal-title', 'goal-current', 'goal-sep', 'goal-target', 'goal-track', 'goal-fill', 'goal-pct', 'goal-flag']) {
      assert.ok(find(root, part), part);
    }
    assert.equal(card.style.properties['--goal-color'], '#3366ff');
    assert.equal(find(root, 'goal-title').textContent, 'Road to 20');
    assert.equal(find(root, 'goal-current').textContent, '7');
    assert.equal(find(root, 'goal-target').textContent, '20');
    assert.equal(find(root, 'goal-pct').textContent, '35%');
    assert.equal(find(root, 'goal-fill').style.width, '35%');
  });

  test('big numbers are grouped as the page\'s language writes them', () => {
    const { api, root } = loadTracking({ lang: 'en' });
    api.renderGoal(goal({ current: 12345, target: 1000000, percent: 1.23 }));
    assert.equal(find(root, 'goal-current').textContent, '12,345');
    assert.equal(find(root, 'goal-target').textContent, '1,000,000');
    assert.equal(find(root, 'goal-pct').textContent, '1%');
  });

  test('a +N pops when the count went up, and a colour that is not #rrggbb falls back to the default green', () => {
    const { api, root } = loadTracking();
    api.renderGoal(goal({ barColor: 'red;background:url(x)' }), { added: 3 });
    assert.equal(find(root, 'goal-card').style.properties['--goal-color'], '#22c55e');
    const pops = root.querySelectorAll('.goal-pop');
    assert.equal(pops.length, 1);
    assert.equal(pops[0].textContent, '+3');
    api.renderGoal(goal({ current: 8 }), { type: 'track_goal' });
    assert.equal(root.querySelectorAll('.goal-pop').length, 1, 'no pop without `added`');
  });

  test('reached: one celebration when it happens, then the bar stays full and says so without celebrating again', () => {
    const { api, root } = loadTracking();
    api.renderGoal(goal());
    assert.equal(confetti(root), 0);
    api.renderGoal(goal({ current: 20, percent: 100, completed: true }), { added: 13, justCompleted: true });
    const card = find(root, 'goal-card');
    assert.ok(card.classList.contains('celebrate'));
    assert.ok(card.classList.contains('completed'));
    const once = confetti(root);
    assert.ok(once > 0, 'confetti');
    assert.equal(find(root, 'goal-pct').textContent, 'GOAL REACHED!');
    api.renderGoal(goal({ current: 21, percent: 100, completed: true }), { added: 1, justCompleted: false });
    assert.equal(confetti(root), once, 'no second celebration');
  });

  test('unavailable: its text instead of the numbers, an empty bar', () => {
    for (const code of ['needs_reconnect', 'not_affiliate']) {
      const { api, root } = loadTracking();
      api.renderGoal(goal({ kind: 'sub', title: 'Sub goal', current: null, percent: 0, unavailable: code }));
      const card = find(root, 'goal-card');
      assert.ok(card.classList.contains('unavailable'), code);
      assert.equal(find(root, 'goal-current').textContent, TEXTS[code]);
      assert.equal(find(root, 'goal-pct').textContent, '');
      assert.equal(find(root, 'goal-fill').style.width, '0%');
      assert.doesNotMatch(card.textContent, /\d/, 'no number is shown');
    }
  });

  test('a reached goal that becomes unavailable is not drawn full (goal.css fills a .completed bar)', () => {
    const { api, root } = loadTracking();
    api.renderGoal(goal({ current: 20, percent: 100, completed: true }));
    api.renderGoal(goal({ current: null, percent: 0, completed: true, unavailable: 'needs_reconnect' }));
    const card = find(root, 'goal-card');
    assert.ok(card.classList.contains('unavailable'));
    assert.ok(!card.classList.contains('completed'), 'no .completed while unavailable');
    assert.equal(find(root, 'goal-fill').style.width, '0%');
    api.renderGoal(goal({ current: 21, percent: 100, completed: true }));
    assert.ok(card.classList.contains('completed'), 'available again: reached again');
    assert.ok(!card.classList.contains('unavailable'));
  });

  test('back from unavailable, the count is shown as it is, not rolled up from the old number', () => {
    const { api, root, frames } = loadTracking({ heldFrames: true });
    api.renderGoal(goal({ current: 5, percent: 25 }));
    frames.splice(0).forEach((fn) => fn(1e9));
    assert.equal(find(root, 'goal-current').textContent, '5');
    api.renderGoal(goal({ current: null, percent: 0, unavailable: 'not_affiliate' }));
    api.renderGoal(goal({ current: 900, percent: 45, target: 2000 }));
    assert.equal(frames.length, 0, 'no roll-up');
    assert.equal(find(root, 'goal-current').textContent, '900', 'straight to the count');
    api.renderGoal(goal({ current: 901, percent: 45, target: 2000 }));
    assert.equal(frames.length, 1, 'later changes roll as before');
  });

  test('no active goal: nothing is drawn; a new goal builds a new card', () => {
    const { api, root } = loadTracking();
    api.renderGoal(goal());
    const first = find(root, 'goal-card');
    api.renderGoal(null);
    assert.equal(root.children.length, 0);
    api.renderGoal(goal({ id: 8 }));
    assert.notEqual(find(root, 'goal-card'), first);
    const same = find(root, 'goal-card');
    api.renderGoal(goal({ id: 8, current: 9 }));
    assert.equal(find(root, 'goal-card'), same, 'the same goal is updated in place');
  });

  test('the streamer\'s title is shown as text', () => {
    const { api, root } = loadTracking();
    api.renderGoal(goal({ title: '<b>x</b><img src=x onerror=alert(1)>' }));
    assert.equal(find(root, 'goal-title').textContent, '<b>x</b><img src=x onerror=alert(1)>');
    assert.ok(!allElements(root).some((el) => el.tagName === 'B' || el.tagName === 'IMG'));
  });
});

describe('a tracker', () => {
  test('a compact card: the small title above, the value below, in Atleta purple until told otherwise', () => {
    const { api, root } = loadTracking();
    api.renderTracker('latest_follower', { name: 'viewer_a' });
    const card = find(root, 'trk-card');
    assert.ok(card);
    assert.equal(card.style.properties['--track-color'], '#9146FF');
    assert.equal(find(root, 'trk-title').textContent, 'Latest follower');
    assert.equal(find(root, 'trk-name').textContent, 'viewer_a');
    assert.equal(find(root, 'trk-detail').textContent, '');
    assert.ok(card.classList.contains('slide'), 'it slides in');
  });

  test('a name with markup in it is shown as text', () => {
    const { api, root } = loadTracking();
    api.renderTracker('latest_follower', { name: '<b>x</b>' });
    assert.equal(find(root, 'trk-name').textContent, '<b>x</b>');
    assert.ok(!allElements(root).some((el) => el.tagName === 'B'));
  });

  test('what each tracker says under the name', () => {
    const cases = [
      ['latest_sub', { name: 'a', months: 5, tier: '1' }, '5 months'],
      ['latest_sub', { name: 'a', months: 1, tier: '1' }, '1 month'],
      ['latest_sub', { name: 'a', gifted: 3 }, 'Gifted 3'],
      ['latest_raid', { name: 'a', viewers: 1200 }, '1,200 viewers'],
      ['latest_raid', { name: 'a', viewers: 1 }, '1 viewer'],
      ['latest_bits', { name: 'a', amount: 500 }, '500 bits'],
      ['latest_bits', { name: 'a', amount: 1 }, '1 bit'],
      ['latest_tip', { name: 'a', amount: 5, currency: 'EUR' }, '€5.00'],
      ['latest_tip', { name: 'a', amount: 2.5, currency: null }, '2.50'],
      ['top_tipper', { name: 'a', amount: 42, currency: 'USD' }, '$42.00'],
    ];
    for (const [tracker, value, detail] of cases) {
      const { api, root } = loadTracking();
      api.renderTracker(tracker, value);
      assert.equal(find(root, 'trk-title').textContent, TEXTS[tracker], tracker);
      assert.equal(find(root, 'trk-detail').textContent, detail, `${tracker} ${JSON.stringify(value)}`);
    }
  });

  test('nothing is drawn while it is empty, for a tracker it does not know, or while it is switched off', () => {
    const { api, root } = loadTracking();
    api.renderTracker('latest_tip', null);
    assert.equal(root.children.length, 0);
    api.renderTracker('latest_hug', { name: 'a' });
    assert.equal(root.children.length, 0);
    api.renderTracker('latest_tip', { name: 'a', amount: 1, currency: 'EUR' });
    assert.equal(root.children.length, 1);
    api.applyTrackerSettings({ enabled: false, color: '#ff0000' });
    assert.equal(root.children.length, 0, 'switched off: hidden');
    api.applyTrackerSettings({ enabled: true, color: '#ff0000' });
    assert.equal(find(root, 'trk-name').textContent, 'a', 'switched on again: the last value comes back');
    assert.equal(find(root, 'trk-card').style.properties['--track-color'], '#ff0000');
    api.applyTrackerSettings({ enabled: true, color: 'nope' });
    assert.equal(find(root, 'trk-card').style.properties['--track-color'], '#9146FF');
  });
});

describe('the page', () => {
  test('dual-exported: the same functions on window.TrackingSource and module.exports', () => {
    const { api, browserApi } = loadTracking();
    assert.equal(typeof api.renderGoal, 'function');
    assert.equal(api.renderTracker, browserApi.renderTracker);
  });

  test('never writes HTML', () => {
    assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  test('a goal source reads its own stream: config, then the goal and its events', () => {
    const { root, sources } = loadTracking({ page: { source: 'goal', events: '/overlay/goal/followers/events/tok' } });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, '/overlay/goal/followers/events/tok');
    sources[0].send({ type: 'config', serverVersion: 'v1' });
    sources[0].send({ type: 'track_goal', goal: goal() });
    assert.equal(find(root, 'goal-current').textContent, '7');
    sources[0].send({ type: 'track_goal', goal: goal({ current: 8, percent: 40 }), added: 1 });
    assert.equal(find(root, 'goal-pop').textContent, '+1');
  });

  test('a new server version reloads the page', () => {
    const { sources, reloads } = loadTracking({ page: { source: 'goal', events: '/e' } });
    sources[0].send({ type: 'config', serverVersion: 'v1' });
    assert.equal(reloads.length, 0);
    sources[0].send({ type: 'config', serverVersion: 'v2' });
    assert.equal(reloads.length, 1);
  });

  test('a tracker source: its settings from the config, its own values, a live switch-off hides it', () => {
    const { root, sources } = loadTracking({ page: { source: 'tracker', tracker: 'latest_raid', events: '/overlay/tracker/latest_raid/events/tok' } });
    const stream = sources[0];
    stream.send({ type: 'config', serverVersion: 'v1', settings: { enabled: true, color: '#00aa00' } });
    stream.send({ type: 'tracker', tracker: 'latest_raid', value: { name: 'raider', viewers: 7 } });
    assert.equal(find(root, 'trk-name').textContent, 'raider');
    assert.equal(find(root, 'trk-card').style.properties['--track-color'], '#00aa00');
    stream.send({ type: 'tracker', tracker: 'latest_bits', value: { name: 'other', amount: 5 } });
    assert.equal(find(root, 'trk-name').textContent, 'raider', 'another tracker\'s value is ignored');
    stream.send({ type: 'tracker_settings', tracker: 'latest_raid', enabled: false, color: '#00aa00' });
    assert.equal(root.children.length, 0);
  });

  test('a switched-off tracker source shows nothing from the start', () => {
    const { root, sources } = loadTracking({ page: { source: 'tracker', tracker: 'latest_tip', events: '/e' } });
    sources[0].send({ type: 'config', serverVersion: 'v1', settings: { enabled: false, color: '#9146FF' } });
    sources[0].send({ type: 'tracker', tracker: 'latest_tip', value: { name: 'a', amount: 1, currency: 'EUR' } });
    assert.equal(root.children.length, 0);
  });

  test('the previews take what the dashboard posts, from its own origin only, and open no stream', () => {
    const goalDemo = loadTracking({ page: { source: 'goal', demo: true } });
    assert.equal(goalDemo.sources.length, 0);
    goalDemo.post({ type: 'track_goal', goal: goal() }, 'https://evil.example');
    assert.equal(goalDemo.root.children.length, 0);
    goalDemo.post({ type: 'track_goal', goal: goal(), added: 2 });
    assert.equal(find(goalDemo.root, 'goal-pop').textContent, '+2');

    const trackerDemo = loadTracking({ page: { source: 'tracker', demo: true } });
    trackerDemo.post({ type: 'tracker_settings', tracker: 'latest_bits', enabled: true, color: '#abcdef' });
    trackerDemo.post({ type: 'tracker', tracker: 'latest_bits', value: { name: 'cheerer', amount: 100 } });
    assert.equal(find(trackerDemo.root, 'trk-title').textContent, 'Latest bits');
    assert.equal(find(trackerDemo.root, 'trk-card').style.properties['--track-color'], '#abcdef');
  });
});
