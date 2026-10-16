'use strict';

// The real public/overlay/overlay.js (and the object registry) run in a vm context
// with a small stand-in for the browser: a fake clock, a tiny element tree, an
// EventSource the test feeds, and recorders for Audio and Web Audio. No network,
// no real browser; what is checked is what the overlay does with the messages
// the server sends.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OVERLAY_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'overlay.js'), 'utf8');
const OBJECTS_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'index.js'), 'utf8');
const PLACEMENT_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'placement.js'), 'utf8');
const KIT_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'kit.js'), 'utf8');
const FX_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'fx.js'), 'utf8');
// The family files joined, as the page loads them from /overlay/objects/styles.js
const STYLES_JS = require('../src/services/alertStyleBundle').bundle().js;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// ── A small browser ──────────────────────────────────────────────────────

function makeStyle() {
  const properties = {};
  return new Proxy({ properties, setProperty(name, value) { properties[name] = String(value); }, removeProperty(name) { delete properties[name]; } }, {
    get(target, key) { return key in target ? target[key] : ''; },
    set(target, key, value) { target[key] = value; return true; },
  });
}

function matches(element, selector) {
  return selector.split(',').map((part) => part.trim()).some((part) => {
    if (part.startsWith('.')) return element.classList.contains(part.slice(1));
    if (part.startsWith('#')) return element.id === part.slice(1);
    return element.tagName.toLowerCase() === part.toLowerCase();
  });
}

function makeElement(tagName = 'div') {
  const element = {
    tagName: tagName.toUpperCase(), id: '', children: [], parentNode: null, style: makeStyle(), dataset: {},
    _classes: new Set(), _html: '', _text: '', attributes: {},
    get className() { return [...this._classes].join(' '); },
    set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
    classList: {
      add: (...names) => names.forEach((n) => element._classes.add(n)),
      remove: (...names) => names.forEach((n) => element._classes.delete(n)),
      contains: (name) => element._classes.has(name),
      toggle: (name, force) => { const on = force === undefined ? !element._classes.has(name) : force; on ? element._classes.add(name) : element._classes.delete(name); },
    },
    // innerHTML assigned from markup is kept as text (children are not parsed);
    // assigned through textContent it is the escaped text, like a real element.
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = String(value); this.children = []; },
    get textContent() { return this._text; },
    set textContent(value) { this._text = value == null ? '' : String(value); this._html = this._text.replace(/[&<>]/g, (c) => ESCAPES[c]); this.children = []; },
    appendChild(child) { child.parentNode = element; element.children.push(child); return child; },
    remove() { if (element.parentNode) element.parentNode.children = element.parentNode.children.filter((c) => c !== element); element.parentNode = null; },
    querySelectorAll(selector) {
      const found = [];
      const walk = (node) => node.children.forEach((child) => { if (matches(child, selector)) found.push(child); walk(child); });
      walk(element);
      return found;
    },
    querySelector(selector) { return element.querySelectorAll(selector)[0] || null; },
    setAttribute(name, value) { element.attributes[name] = String(value); },
    removeAttribute(name) { delete element.attributes[name]; },
    addEventListener() {},
    pause() {}, load() {}, play() { return Promise.resolve(); },
  };
  return element;
}

// A clock the test moves by hand; setTimeout/clearTimeout work on it.
function makeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms = 0) { const id = nextId++; pending.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, id }); return id; },
    clearTimeout(id) { pending.delete(id); },
    get pending() { return pending.size; },
    // Runs every timer due within `ms`, in order, including ones they schedule.
    advance(ms, onTick) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.values()].filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        pending.delete(due.id);
        now = due.at;
        due.fn();
        if (onTick) onTick(now);
      }
      now = target;
    },
    get now() { return now; },
  };
}

// Loads overlay.js (and, unless told not to, the object registry) into a fresh context. `styles` also
// loads the kit and the joined family files of the alert looks; `kit` the kit alone, as a page whose
// styles.js did not load. `channel` is the name the overlay page gives the C1 (window.ATLETA_CHANNEL).
function loadOverlay({ objects = true, styles = false, kit = styles, designs = {}, channel } = {}) {
  const clock = makeClock();
  const body = makeElement('body');
  const container = makeElement('div'); container.id = 'notification-container'; body.appendChild(container);
  const timedContainer = makeElement('div'); timedContainer.id = 'timed-container'; body.appendChild(timedContainer);
  const byId = { 'notification-container': container, 'timed-container': timedContainer, 'redemption-video': makeElement('video'), 'redemption-audio': makeElement('audio') };

  const audio = { instances: [], oscillators: 0, bufferSources: 0 };
  class FakeAudio {
    constructor(url) { this.url = url; this.volume = 1; this.played = false; audio.instances.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() {}
  }
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param() });
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume() {}
    createOscillator() { audio.oscillators++; return node(); }
    createBufferSource() { audio.bufferSources++; return node(); }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createGain() { return node(); }
    createWaveShaper() { return node(); }
    createBiquadFilter() { return node(); }
  }

  const sources = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
  }

  const errors = [];
  const sandbox = {
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
    document: {
      body,
      getElementById: (id) => byId[id] || null,
      createElement: (tag) => makeElement(tag),
      querySelectorAll: (selector) => body.querySelectorAll(selector),
      head: makeElement('head'),
    },
    location: { reload() { sandbox.reloaded = true; } },
    EventSource: FakeEventSource,
    Audio: FakeAudio,
    AudioContext: FakeAudioContext,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    requestAnimationFrame: (fn) => clock.setTimeout(fn, 16),
    Math, Number, String, Array, Object, JSON, Set, Map, Promise, Float32Array, Intl, Date, parseInt, parseFloat, isFinite, Proxy,
    reloaded: false,
  };
  sandbox.window = sandbox;
  sandbox.OVERLAY_TOKEN = 'test-token';
  // The overlay page names the streamer's Twitch channel for the C1's rear window (src/routes/overlay.js).
  if (channel !== undefined) sandbox.ATLETA_CHANNEL = channel;
  const context = vm.createContext(sandbox);
  if (objects) vm.runInContext(OBJECTS_JS, context, { filename: 'objects/index.js' });
  if (kit) vm.runInContext(KIT_JS, context, { filename: 'objects/kit.js' });
  if (styles) vm.runInContext(STYLES_JS, context, { filename: 'objects/styles.js' });
  vm.runInContext(FX_JS, context, { filename: 'fx.js' });
  vm.runInContext(PLACEMENT_JS, context, { filename: 'placement.js' });
  vm.runInContext(OVERLAY_JS, context, { filename: 'overlay.js' });

  const overlay = {
    clock, container, audio, sandbox, context, errors,
    // Feed the overlay a message as the server's event stream would.
    send(message) { sources[sources.length - 1].onmessage({ data: JSON.stringify(message) }); },
    // Read or call anything the script declared at its top level.
    run(code) { return vm.runInContext(code, context); },
    slots() { return container.children.filter((c) => c.classList.contains('alert-pos')); },
  };
  overlay.send({ type: 'config', serverVersion: 'v1', designs, config: baseConfig() });
  return overlay;
}

function baseConfig(over = {}) {
  return {
    follow: { enabled: true, duration: 5 }, subscription: { enabled: true, duration: 7 }, bits: { enabled: true, duration: 6 },
    donation: { enabled: true, duration: 6 }, raid: { enabled: true, duration: 7 }, giveaway_winner: { enabled: true, duration: 8 },
    yt_superchat: { enabled: true, duration: 6 }, yt_member: { enabled: true, duration: 5 }, yt_giftmember: { enabled: true, duration: 6 },
    volume: 0.8, sounds: {},
    ...over,
  };
}

const follow = (name = 'RacerDan') => ({ type: 'follow', data: { username: name } });

// ── M6: settings reach an overlay that is already open ───────────────────

describe('the volume', () => {
  test('0 is silent: an alert plays neither the custom sound nor the synthesized one', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ volume: 0, sounds: { follow: '/overlay/sounds/t/follow?v=1' } }) });
    overlay.send(follow());
    assert.equal(overlay.audio.instances.length, 0, 'no custom sound element was started');
    assert.equal(overlay.audio.oscillators + overlay.audio.bufferSources, 0, 'nothing was synthesized');
    assert.equal(overlay.slots().length, 1, 'the alert itself still shows');
  });

  test('0 on the first config is just as silent', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config', serverVersion: 'v1', config: baseConfig({ volume: 0 }) });
    overlay.send(follow());
    assert.equal(overlay.audio.oscillators + overlay.audio.bufferSources, 0);
  });

  test('a custom sound plays at the saved volume, not at 0.8', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ volume: 0.3, sounds: { follow: '/overlay/sounds/t/follow?v=1' } }) });
    overlay.send(follow());
    assert.equal(overlay.audio.instances.length, 1);
    assert.equal(overlay.audio.instances[0].volume, 0.3);
    assert.equal(overlay.audio.instances[0].url, '/overlay/sounds/t/follow?v=1');
  });

  test('with no usable volume the default 0.8 is used, and the synthesized sound plays', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ volume: undefined }) });
    assert.equal(overlay.run('overlayVolume()'), 0.8);
    overlay.send(follow());
    assert.ok(overlay.audio.oscillators > 0 || overlay.audio.bufferSources > 0, 'a synthesized sound plays');
  });

  test('a volume outside 0-1 or not a number is brought into range or replaced', () => {
    const overlay = loadOverlay();
    for (const [sent, expected] of [[7, 1], [-1, 0], ['0.5', 0.8], [null, 0.8], [NaN, 0.8]]) {
      overlay.send({ type: 'config-update', config: baseConfig({ volume: sent }) });
      assert.equal(overlay.run('overlayVolume()'), expected, String(sent));
    }
  });
});

describe('a pushed config applies to the next alert without a reload', () => {
  test('a switched-off alert is no longer shown, and switching it on shows it again', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: false, duration: 5 } }) });
    overlay.send(follow());
    assert.equal(overlay.slots().length, 0, 'follow is off');
    overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: true, duration: 5 } }) });
    overlay.send(follow());
    assert.equal(overlay.slots().length, 1, 'follow is on again');
    assert.equal(overlay.sandbox.reloaded, false);
  });

  test('raid and the YouTube alerts honour their toggles (they had no entry before)', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ raid: { enabled: false, duration: 7 } }) });
    overlay.send({ type: 'raid', data: { username: 'GridWalker', viewers: 42 } });
    assert.equal(overlay.slots().length, 0, 'raid is off');
    overlay.send({ type: 'config-update', config: baseConfig({ yt_superchat: { enabled: false, duration: 6 } }) });
    overlay.send({ type: 'yt_superchat', data: { username: 'Viewer', amount: '$5.00', message: 'hi' } });
    assert.equal(overlay.slots().length, 0, 'Super Chat is off');
  });

  test('a new duration is used for the next alert', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: true, duration: 12 } }) });
    assert.equal(overlay.run('alertSeconds("follow")'), 12);
    overlay.send(follow());
    overlay.clock.advance(11000);
    assert.equal(overlay.slots().length, 1, 'still showing after 11 s');
    overlay.clock.advance(1500);
    assert.equal(overlay.slots().length, 0, 'gone after 12 s and the exit');
  });

  test('the giveaway winner is shown for its duration in seconds', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ giveaway_winner: { enabled: true, duration: 20 } }) });
    assert.equal(overlay.run('alertSeconds("giveaway_winner")'), 20);
  });

  test('a duration that is missing, zero or not a number falls back to 5 seconds', () => {
    const overlay = loadOverlay();
    for (const duration of [undefined, 0, -3, 'abc', NaN, null]) {
      overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: true, duration } }) });
      assert.equal(overlay.run('alertSeconds("follow")'), 5, String(duration));
    }
    assert.equal(overlay.run('alertSeconds("something_else")'), 5);
  });

  test('a config-update without a config (designs or sounds only) leaves the settings as they were', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig({ volume: 0.4 }) });
    overlay.send({ type: 'config-update', designs: {} });
    overlay.send({ type: 'config-update', sounds: { follow: '/overlay/sounds/t/follow?v=2' } });
    assert.equal(overlay.run('overlayVolume()'), 0.4);
    assert.equal(overlay.run('overlayConfig.sounds.follow'), '/overlay/sounds/t/follow?v=2');
  });

  test('a config message without a config keeps the earlier one, and a new server version still reloads', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config', serverVersion: 'v1' });
    assert.equal(overlay.run('overlayVolume()'), 0.8);
    assert.equal(overlay.run('overlayConfig.follow.duration'), 5);
    overlay.send({ type: 'config', serverVersion: 'v2', config: baseConfig() });
    assert.equal(overlay.sandbox.reloaded, true);
  });

  test('a push does not disturb the deploy check: the server version is kept', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', config: baseConfig() });
    overlay.send({ type: 'config', serverVersion: 'v1', config: baseConfig() });
    assert.equal(overlay.sandbox.reloaded, false, 'the same version does not reload');
    overlay.send({ type: 'config', serverVersion: 'v9', config: baseConfig() });
    assert.equal(overlay.sandbox.reloaded, true, 'a new version still does');
  });
});

describe('chat lines stay out of the alert queue', () => {
  test('a chat line is ignored (it shares the stream with the iRacing chat overlay)', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'chat', data: { username: 'viewer', message: 'hello' } });
    assert.equal(overlay.slots().length, 0);
    assert.equal(overlay.run('queue.length'), 0);
  });
});

// ── L5: Clear All ────────────────────────────────────────────────────────

describe('Clear All', () => {
  // Counts every alert slot that is ever put on screen, and how many are on screen at once.
  function watch(overlay) {
    const seen = { shown: 0, maxAtOnce: 0 };
    const append = overlay.container.appendChild.bind(overlay.container);
    overlay.container.appendChild = (child) => {
      if (child.classList.contains('alert-pos')) seen.shown++;
      return append(child);
    };
    seen.sample = () => { seen.maxAtOnce = Math.max(seen.maxAtOnce, overlay.slots().length); };
    return seen;
  }

  test('removes the alert on screen and everything waiting behind it', () => {
    const overlay = loadOverlay();
    overlay.send(follow('A')); overlay.send(follow('B')); overlay.send(follow('C'));
    assert.equal(overlay.slots().length, 1);
    assert.equal(overlay.run('queue.length'), 2);
    overlay.send({ type: 'clear' });
    assert.equal(overlay.slots().length, 0);
    assert.equal(overlay.run('queue.length'), 0);
    assert.equal(overlay.run('isPlaying'), false);
  });

  test('cancels the dismiss, removal and next-alert timers of what it cleared', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'giveaway_winner', data: { username: 'Winner', prize: 'Steam key' } });
    overlay.clock.advance(2000);
    assert.ok(overlay.run('alertTimers.size') > 0, 'the alert has a dismiss timer running');
    overlay.send({ type: 'clear' });
    assert.equal(overlay.run('alertTimers.size'), 0);
    assert.equal(overlay.clock.pending, 0, 'no timer of the cleared alert is left to fire');
  });

  test('two alerts that come after a clear play one at a time, not on top of each other', () => {
    const overlay = loadOverlay();
    // An alert is cleared two seconds in; its timers used to keep running.
    overlay.send({ type: 'giveaway_winner', data: { username: 'Winner', prize: 'Steam key' } });
    overlay.clock.advance(2000);
    overlay.send({ type: 'clear' });
    overlay.clock.advance(1000);

    const seen = watch(overlay);
    overlay.send(follow('A')); overlay.send(follow('B')); overlay.send(follow('C')); overlay.send(follow('D'));
    seen.sample();
    overlay.clock.advance(120000, seen.sample);
    assert.equal(seen.shown, 4, 'every alert after the clear is shown');
    assert.equal(seen.maxAtOnce, 1, 'never two at once');
    assert.equal(overlay.slots().length, 0, 'and all are gone at the end');
    assert.equal(overlay.run('isPlaying'), false);
  });

  test('clearing a second time, while a replacement is on screen, cleans that up too', () => {
    const overlay = loadOverlay();
    overlay.send(follow('A'));
    overlay.clock.advance(1500);
    overlay.send({ type: 'clear' });
    overlay.send(follow('B'));
    overlay.clock.advance(1500);
    overlay.send({ type: 'clear' });
    assert.equal(overlay.slots().length, 0);
    const seen = watch(overlay);
    overlay.send(follow('C'));
    seen.sample();
    overlay.clock.advance(60000, seen.sample);
    assert.equal(seen.shown, 1);
    assert.equal(seen.maxAtOnce, 1);
  });

  test('alerts that were never cleared keep their normal pace: one every duration plus the exit and the gap', () => {
    const overlay = loadOverlay();
    const seen = watch(overlay);
    overlay.send(follow('A')); overlay.send(follow('B'));
    overlay.clock.advance(5000 + 400 + 500 - 1);
    assert.equal(seen.shown, 1, 'B waits for A\'s 5 s, its exit and the half-second gap');
    overlay.clock.advance(1);
    assert.equal(seen.shown, 2);
  });
});

// ── N1 and M7: every alert sits where its saved design says ──────────────

// What the stream sends for a saved design: the columns that matter here.
// (A saved row always has its colours and effects too; the legacy cards read them all.)
const design = (over = {}) => ({
  bg_color: '#1c1200', accent_color: '#f59e0b', border_color: '#f59e0b', text_color: '#ffffff', font_family: 'System Default',
  username_size: 24, event_label: 'Giveaway Winner!', detail_text: '', car_animation: 'zoomLR', screen_effect: 'none', animation_speed: 1,
  card_position: 'top-center', card_custom_x: null, card_custom_y: null, card_width: 420, border_radius: 16, entrance_animation: 'slideDown',
  bg_opacity: 1, gradient_direction: '160deg', border_thickness: 2, border_opacity: 0.5, glow_intensity: 0.25,
  shadow_opacity: 0.6, shadow_blur: 32, shadow_spread: 0, text_align: 'center',
  ...over,
});
const OBJECT_ALERTS = [
  ['follow', { username: 'RacerDan' }], ['subscription', { username: 'RacerDan', tier: '1', months: 3 }],
  ['bits', { username: 'RacerDan', amount: 500 }], ['donation', { username: 'RacerDan', amount: 25, currency: 'EUR' }],
  ['raid', { username: 'RacerDan', viewers: 42 }],
];
const LEGACY_ALERTS = [
  ['giveaway_winner', { username: 'RacerDan', prize: 'Steam key' }], ['yt_superchat', { username: 'RacerDan', amount: '$5.00', message: 'hi' }],
  ['yt_member', { username: 'RacerDan', level: 'Member' }], ['yt_giftmember', { username: 'RacerDan', amount: 5 }],
];
const POSITION_STYLES = {
  'top-left': { top: '16px', right: 'auto', bottom: 'auto', left: '16px', transform: 'none' },
  'top-center': { top: '16px', right: 'auto', bottom: 'auto', left: '50%', transform: 'translate(-50%, 0)' },
  'top-right': { top: '16px', right: '16px', bottom: 'auto', left: 'auto', transform: 'none' },
  'mid-left': { top: '50%', right: 'auto', bottom: 'auto', left: '16px', transform: 'translate(0, -50%)' },
  'mid-center': { top: '50%', right: 'auto', bottom: 'auto', left: '50%', transform: 'translate(-50%, -50%)' },
  'mid-right': { top: '50%', right: '16px', bottom: 'auto', left: 'auto', transform: 'translate(0, -50%)' },
  'bot-left': { top: 'auto', right: 'auto', bottom: '16px', left: '16px', transform: 'none' },
  'bot-center': { top: 'auto', right: 'auto', bottom: '16px', left: '50%', transform: 'translate(-50%, 0)' },
  'bot-right': { top: 'auto', right: '16px', bottom: '16px', left: 'auto', transform: 'none' },
};
const placed = (slot) => ({ top: slot.style.top, right: slot.style.right, bottom: slot.style.bottom, left: slot.style.left, transform: slot.style.transform });

describe('the five Twitch alerts honour their saved position and width (N1)', () => {
  for (const [type, data] of OBJECT_ALERTS) {
    test(`${type}: every grid position`, () => {
      for (const [position, expected] of Object.entries(POSITION_STYLES)) {
        const overlay = loadOverlay({ designs: { [type]: design({ card_position: position, card_width: 560 }) } });
        overlay.send({ type, data });
        const [slot] = overlay.slots();
        assert.deepEqual(placed(slot), expected, `${type} at ${position}`);
        assert.equal(slot.style.width, '560px', `${type} width`);
      }
    });

    test(`${type}: a dragged position is where it was dropped, and wins over the grid cell`, () => {
      const overlay = loadOverlay({ designs: { [type]: design({ card_position: 'bot-right', card_custom_x: 0.3, card_custom_y: 0.6 }) } });
      overlay.send({ type, data });
      assert.deepEqual(placed(overlay.slots()[0]), { top: '60%', right: 'auto', bottom: 'auto', left: '30%', transform: 'none' });
    });

    test(`${type}: without a saved design it stays top-centre at 420px`, () => {
      const overlay = loadOverlay();
      overlay.send({ type, data });
      const [slot] = overlay.slots();
      assert.deepEqual(placed(slot), POSITION_STYLES['top-center']);
      assert.equal(slot.style.width, '420px');
    });
  }

  test('an alert is still an object: markup from the registry, played by .playing, and the slot is the only wrapper', () => {
    const overlay = loadOverlay({ designs: { follow: design({ card_position: 'bot-left' }) } });
    overlay.send(follow());
    const [slot] = overlay.slots();
    assert.ok(slot.classList.contains('playing'));
    assert.match(slot.innerHTML, /class="obj o-follow"/);
    assert.equal(slot.children.length, 0, 'the markup is the slot\'s own content');
    assert.equal(slot.style.properties['--in'], 'cutWipe');
  });

  test('a design pushed while the overlay is open applies to the next alert, with no reload', () => {
    const overlay = loadOverlay();
    overlay.send(follow('A'));
    assert.deepEqual(placed(overlay.slots()[0]), POSITION_STYLES['top-center']);
    overlay.send({ type: 'clear' });
    overlay.send({ type: 'config-update', designs: { follow: design({ card_position: 'mid-right', card_width: 300 }) } });
    overlay.send(follow('B'));
    assert.deepEqual(placed(overlay.slots()[0]), POSITION_STYLES['mid-right']);
    assert.equal(overlay.slots()[0].style.width, '300px');
    assert.equal(overlay.sandbox.reloaded, false);
  });

  test('the exit still runs on the slot, and the slot is gone afterwards', () => {
    const overlay = loadOverlay({ designs: { follow: design({ card_position: 'bot-right' }) } });
    overlay.send(follow());
    const [slot] = overlay.slots();
    overlay.clock.advance(5000);
    assert.ok(slot.classList.contains('exiting'));
    assert.ok(!slot.classList.contains('playing'));
    assert.equal(slot.style.properties['--out'], 'exSheathe');
    overlay.clock.advance(400);
    assert.equal(overlay.slots().length, 0);
  });
});

describe('the giveaway winner and the YouTube cards honour them too (M7)', () => {
  for (const [type, data] of LEGACY_ALERTS) {
    test(`${type}: every grid position puts the slot there and the card fills it`, () => {
      for (const [position, expected] of Object.entries(POSITION_STYLES)) {
        const overlay = loadOverlay({ designs: { [type]: design({ card_position: position, card_width: 500 }) } });
        overlay.send({ type, data });
        const [slot] = overlay.slots();
        assert.deepEqual(placed(slot), expected, `${type} at ${position}`);
        assert.equal(slot.style.width, '500px');
        assert.equal(slot.children.length, 1);
        assert.ok(slot.children[0].classList.contains('alert-card'), 'the card is inside the slot');
        assert.equal(slot.children[0].style.top, '', 'the card itself carries no position');
        assert.equal(slot.children[0].style.left, '');
        assert.equal(slot.children[0].style.transform, '');
      }
    });

    test(`${type}: a dragged position, 0 included`, () => {
      const overlay = loadOverlay({ designs: { [type]: design({ card_position: 'bot-right', card_custom_x: 0, card_custom_y: 0.5 }) } });
      overlay.send({ type, data });
      assert.deepEqual(placed(overlay.slots()[0]), { top: '50%', right: 'auto', bottom: 'auto', left: '0%', transform: 'none' });
    });
  }

  test('every entrance animation works at a position that is not top-centre', () => {
    for (const entrance of ['slideUp', 'slideLeft', 'slideRight', 'zoomIn', 'fadeIn']) {
      const overlay = loadOverlay({ designs: { giveaway_winner: design({ card_position: 'bot-right', entrance_animation: entrance, animation_speed: 1 }) } });
      overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
      const card = overlay.slots()[0].children[0];
      assert.equal(card.style.animation, `${entrance} 0.4s ease-out forwards`, entrance);
      assert.ok(!card.classList.contains('entering'), `${entrance} replaces the default entrance`);
    }
  });

  test('a dragged card still gets its entrance animation (it used to be replaced by a fade)', () => {
    const overlay = loadOverlay({ designs: { yt_member: design({ card_custom_x: 0.2, card_custom_y: 0.2, entrance_animation: 'zoomIn' }) } });
    overlay.send({ type: 'yt_member', data: { username: 'RacerDan', level: 'Member' } });
    assert.equal(overlay.slots()[0].children[0].style.animation, 'zoomIn 0.4s ease-out forwards');
  });

  test('the default entrance is the .entering class', () => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ card_position: 'mid-left' }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
    assert.ok(overlay.slots()[0].children[0].classList.contains('entering'));
  });

  test('the card fades out and the whole slot is removed', () => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ card_position: 'top-right' }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
    const [slot] = overlay.slots();
    overlay.clock.advance(8000);
    assert.equal(slot.children[0].style.opacity, '0');
    overlay.clock.advance(400);
    assert.equal(overlay.slots().length, 0);
    assert.equal(overlay.container.children.length, 0);
  });

  // An animation's last frame (opacity 1) is held over any inline opacity, so the fade only runs once
  // the entrance is off the card: the default one (.entering) and a saved one (inline), which for
  // the member card also means the animation .sub-shake brings. Checked in a real browser too:
  // before, these cards stayed at full opacity until the slot was removed.
  describe('the fade at the end of a card', () => {
    const CARDS = [
      ['giveaway_winner', { username: 'RacerDan', prize: 'x' }],
      ['yt_superchat', { username: 'RacerDan', amount: '$5.00', message: 'hi' }],
      ['yt_member', { username: 'RacerDan', level: 'Member' }],
      ['yt_giftmember', { username: 'RacerDan', amount: 5 }],
    ];

    for (const [type, data] of CARDS) {
      for (const entrance of [undefined, 'slideDown', 'slideUp', 'zoomIn', 'fadeIn']) {
        test(`${type}${entrance ? ` with the saved entrance ${entrance}` : ' with the default entrance'}: the entrance is off when the fade starts`, () => {
          const overlay = loadOverlay({ designs: entrance ? { [type]: design({ entrance_animation: entrance }) } : {} });
          overlay.send({ type, data });
          const card = overlay.slots()[0].children[0];
          const seconds = overlay.run(`alertSeconds(${JSON.stringify(type)})`);

          overlay.clock.advance(seconds * 1000 - 1);
          assert.equal(card.style.opacity, '', 'not faded while the alert is on screen');
          assert.notEqual(card.style.animation, 'none', 'the entrance is left alone until then');

          overlay.clock.advance(1);
          assert.ok(!card.classList.contains('entering'), 'the default entrance is taken off');
          assert.equal(card.style.animation, 'none', 'so is a saved one (and the shake of the member card)');
          assert.equal(card.style.transition, 'opacity 0.3s ease-in');
          assert.equal(card.style.opacity, '0');
          assert.equal(overlay.slots().length, 1, 'the slot stays for the fade');

          overlay.clock.advance(400);
          assert.equal(overlay.slots().length, 0, 'and goes when it is done');
        });
      }
    }

    test('the five alert objects are not touched: they leave with their own exit', () => {
      for (const [type, data] of OBJECT_ALERTS) {
        const overlay = loadOverlay();
        overlay.send({ type, data });
        const [slot] = overlay.slots();
        overlay.clock.advance(overlay.run(`alertSeconds(${JSON.stringify(type)})`) * 1000);
        assert.ok(slot.classList.contains('exiting'), `${type} exits`);
        assert.ok(!slot.classList.contains('playing'), type);
        assert.equal(slot.style.opacity, '', `${type}: no inline fade on an object`);
        assert.equal(slot.style.animation, '', type);
      }
    });
  });

  test('a border radius of 0 is a square corner, not 16', () => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ border_radius: 0 }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
    assert.equal(overlay.slots()[0].children[0].style.borderRadius, '0px');
  });

  test('a missing or unusable radius is the default 16', () => {
    for (const radius of [undefined, null, 'round', NaN]) {
      const overlay = loadOverlay({ designs: { giveaway_winner: design({ border_radius: radius }) } });
      overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
      assert.equal(overlay.slots()[0].children[0].style.borderRadius, '16px', String(radius));
    }
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ border_radius: 24 }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
    assert.equal(overlay.slots()[0].children[0].style.borderRadius, '24px');
  });
});

// ── N17: text from a saved design or an event is never markup ────────────

describe('text is shown as text (N17)', () => {
  const HOSTILE = '<img src=x onerror=alert(1)>';
  const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

  test('a side icon from a saved design is escaped, on both sides of the card', () => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ card_side_icon: HOSTILE }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Steam key' } });
    const card = overlay.slots()[0].children[0];
    assert.ok(!card.innerHTML.includes('<img'), 'no markup from the icon');
    assert.equal(card.innerHTML.split(ESCAPED).length - 1, 2, 'the icon is on both sides, as text');
  });

  test('an ordinary emoji icon is untouched', () => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ card_side_icon: '🏆' }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Steam key' } });
    assert.equal(overlay.slots()[0].children[0].innerHTML.split('<span class="cup">🏆</span>').length - 1, 2);
  });

  test('the default side icons are the builder\'s, alert for alert', () => {
    // overlay-builder.ejs keeps the table the preview draws; the overlay must draw the same cups.
    const builder = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'overlay-builder.ejs'), 'utf8');
    const match = builder.match(/const DEFAULT_SIDE_ICONS = (\{[\s\S]*?\n\});/);
    assert.ok(match, 'found the table in the builder');
    const builderIcons = vm.runInNewContext(`(${match[1]})`);
    assert.ok(Object.keys(builderIcons).length >= 10);
    const overlay = loadOverlay();
    for (const [type, icon] of Object.entries(builderIcons)) {
      assert.equal(overlay.run(`getSideIcon(${JSON.stringify(type)})`), icon, type);
    }
  });

  test('a giveaway winner card has the party popper on both sides when the design sets no icon', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Steam key' } });
    assert.equal(overlay.slots()[0].children[0].innerHTML.split('<span class="cup">🎉</span>').length - 1, 2);
  });

  test('the default icon of a card type is still there when the design sets none', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'yt_member', data: { username: 'RacerDan', level: 'Member' } });
    assert.match(overlay.slots()[0].children[0].innerHTML, /<span class="cup">⭐<\/span>/);
  });

  test('the "none" icon removes the cups', () => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ card_side_icon: 'none' }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
    assert.ok(!overlay.slots()[0].children[0].innerHTML.includes('cup-row'));
  });

  test('a follow detail text from a saved design is set as text, not parsed', () => {
    const overlay = loadOverlay({ objects: false, designs: { follow: design({ detail_text: '<b onmouseover=alert(1)>hi</b>' }) } });
    const card = makeElement();
    card.className = 'alert-card follow-card entering';
    const detail = makeElement();
    detail.className = 'detail';
    card.appendChild(detail);
    overlay.context.applyCustomDesign(card, 'follow');
    assert.equal(detail.textContent, '<b onmouseover=alert(1)>hi</b>');
    assert.ok(!detail.innerHTML.includes('<b '), 'the markup is escaped');
  });

  test('the usernames, prizes and amounts that come with an event are escaped as well', () => {
    for (const type of ['giveaway_winner', 'yt_giftmember', 'yt_superchat', 'yt_member']) {
      const overlay = loadOverlay();
      overlay.send({ type, data: { username: HOSTILE, prize: HOSTILE, amount: HOSTILE, message: HOSTILE, level: HOSTILE } });
      const markup = overlay.slots()[0].children[0].innerHTML;
      assert.ok(!markup.includes('<img'), `${type}: no raw markup`);
      assert.ok(markup.includes(ESCAPED), `${type}: shown as text`);
    }
  });
});

// ── C-a: "Solid (no gradient)" ───────────────────────────────────────────

describe('"Solid (no gradient)" on a card', () => {
  const backgroundFor = (gradient_direction) => {
    const overlay = loadOverlay({ designs: { giveaway_winner: design({ gradient_direction, bg_color: '#112233', bg_opacity: 0.8 }) } });
    overlay.send({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'x' } });
    return overlay.slots()[0].children[0].style.background;
  };

  test('is one flat colour at the saved opacity, with no gradient in it', () => {
    assert.equal(backgroundFor('solid'), 'rgba(17,34,51,0.8)');
  });

  test('every other direction is a gradient in that direction', () => {
    for (const direction of ['160deg', '180deg', '0deg', '90deg', '270deg', '135deg', '45deg']) {
      assert.match(backgroundFor(direction), new RegExp(`^linear-gradient\\(${direction}, rgba\\(`), direction);
    }
  });

  test('a missing direction is the default diagonal', () => {
    for (const missing of [undefined, null, '']) assert.match(backgroundFor(missing), /^linear-gradient\(160deg, /, String(missing));
  });
});

// ── Styles: andre_vilela_'s C1 donation alert ───────────────────────────

describe("an alert's saved style picks its object (andre_vilela_'s C1)", () => {
  const tip = { type: 'donation', data: { username: 'PitBoss92', amount: 25, currency: 'EUR', message: 'Keep racing!' } };

  test('a donation whose design names donation-c1 is the C1, played like every object', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    const [slot] = overlay.slots();
    assert.match(slot.innerHTML, /^<div class="obj o-c1">/);
    assert.ok(slot.classList.contains('playing'));
    assert.equal(slot.style.properties['--in'], 'hold');
    assert.equal(slot.style.properties['--dur'], '1.25s');
  });

  test('without a style the donation is the folding screen, as for everyone else', () => {
    const overlay = loadOverlay({ designs: { donation: design() } });
    overlay.send(tip);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-don"/);
  });

  test('a style the page does not know, or one that draws another alert, leaves the alert its own object', () => {
    const cases = [
      ['donation', tip.data, 'o-don', ['donation-gp', '__proto__', 'constructor', 'toString']],
      ['follow', { username: 'RacerDan' }, 'o-follow', ['donation-c1', '__proto__']],
    ];
    for (const [type, data, own, styles] of cases) {
      for (const style of styles) {
        const overlay = loadOverlay({ designs: { [type]: design({ style }) } });
        overlay.send({ type, data });
        assert.match(overlay.slots()[0].innerHTML, new RegExp(`class="obj ${own}"`), `${type} with style ${style}`);
      }
    }
  });

  test('the C1 sits where his donation alert is saved, at its width', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1', card_position: 'bot-right', card_width: 520 }) } });
    overlay.send(tip);
    const [slot] = overlay.slots();
    assert.deepEqual(placed(slot), POSITION_STYLES['bot-right']);
    assert.equal(slot.style.width, '520px');
  });

  test('the C1 any streamer can pick (donation-c1-channel) carries the name the overlay page gives, and leaves like his', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1-channel' }) }, channel: 'RICARDOBSILVA98' });
    overlay.send(tip);
    const [slot] = overlay.slots();
    assert.match(slot.innerHTML, /^<div class="obj o-c1">/);
    assert.match(slot.innerHTML, /<text class="o-c1-decal"[^>]*>RICARDOBSILVA98<\/text>/);
    assert.ok(!slot.innerHTML.includes('VILELA'));
    assert.equal(slot.style.properties['--dur'], '1.25s');
    overlay.clock.advance(6000); // the donation's 6 s in baseConfig
    assert.equal(slot.style.properties['--outdur'], '0.90s');
    overlay.clock.advance(899);
    assert.equal(overlay.slots().length, 1, 'still driving off');
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 0);
  });

  test('a style pushed while the overlay is open applies to the next donation, with no reload', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-c1"/);
    assert.equal(overlay.sandbox.reloaded, false);
  });

  test('the C1 stays on screen for its whole 0.9 s exit, and the next alert waits for it', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    overlay.send(follow('Next'));
    overlay.clock.advance(6000); // the donation's 6 s in baseConfig
    const [slot] = overlay.slots();
    assert.ok(slot.classList.contains('exiting'));
    assert.equal(slot.style.properties['--out'], 'hold');
    assert.equal(slot.style.properties['--outdur'], '0.90s');
    overlay.clock.advance(899);
    assert.equal(overlay.slots().length, 1, 'still driving off');
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 0);
    overlay.clock.advance(499);
    assert.equal(overlay.slots().length, 0, 'then the half-second gap');
    overlay.clock.advance(1);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-follow"/);
  });

  test('the folding screen still leaves after 400 ms', () => {
    const overlay = loadOverlay({ designs: { donation: design() } });
    overlay.send(tip);
    overlay.clock.advance(6000 + 399);
    assert.equal(overlay.slots().length, 1);
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 0);
  });

  test('Clear All while the C1 drives off removes it at once, and nothing it scheduled comes back', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    overlay.send(follow('Queued'));
    overlay.clock.advance(6000 + 300); // 0.3 s into its exit
    overlay.send({ type: 'clear' });
    assert.equal(overlay.slots().length, 0, 'the clear removes the C1 at once');
    overlay.send(follow('After'));
    overlay.clock.advance(1200);          // past the stale 6900 removal and 7400 next-alert timers
    overlay.send(follow('Third'));
    assert.equal(overlay.slots().length, 1, 'Third waits behind After');
  });

  test('a style switched off while a C1 is on screen: that one still drives off in 0.9 s, the next donation is the folding screen', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    overlay.send(tip);
    overlay.send({ type: 'config-update', designs: { donation: design() } });
    overlay.clock.advance(6000 + 899);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-c1"/, 'the alert on screen keeps the exit it started with');
    overlay.clock.advance(1 + 500);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-don"/);
  });

  test('a donor name and message made of markup are shown as text, by the OBS page\'s own escape', () => {
    // overlay.js declares its own DOM-based esc() (it does not escape quotes), and on the real page it replaces the
    // registry's: both scripts share one global scope. loadOverlay() runs them in one context, so this is the escape
    // the C1 really uses in OBS. All of the C1's donor text is element content, where that is enough.
    const NAME = '<img src=x onerror=alert(1)>"Q"\'S\'&A';
    const MESSAGE = '<script>alert(1)</script>';
    const decode = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    // Every tag with its attribute names and the values blanked: a donor's text must not add a tag or an attribute.
    const shape = (html) => [...html.matchAll(/<([a-zA-Z][^<>]*)>/g)].map((m) => m[1].replace(/"[^"]*"/g, '""')).join('\n');
    const play = (username, message) => {
      const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
      overlay.send({ type: 'donation', data: { username, amount: 25, currency: 'USD', message } });
      return overlay.slots()[0].innerHTML;
    };

    const html = play(NAME, MESSAGE);
    assert.match(html, /^<div class="obj o-c1">/, 'it is the C1');
    assert.ok(!html.includes('<img') && !html.includes('<script'), 'no raw markup from the donor');
    assert.equal(shape(html), shape(play('RacerDan', 'Keep racing!')), 'the same tags and attributes as for an ordinary donor');

    const from = /<div class="o-c1-from">([^]*?)<\/div>/.exec(html)[1];
    const message = /<div class="o-c1-msg">([^]*?)<\/div>/.exec(html)[1];
    assert.ok(!/[<>]/.test(from) && !/[<>]/.test(message), 'the donor\'s text holds no angle bracket');
    assert.ok(from.includes('&lt;img src=x onerror=alert(1)&gt;') && from.includes('&amp;A'), 'the name is escaped');
    assert.equal(decode(from), NAME, 'and reads back as the donor typed it');
    assert.equal(decode(message), `"${MESSAGE}"`, 'so does the message, between its quotes');
  });
});

describe('the look an alert is drawn in (alert styles)', () => {
  const giveaway = (prize = 'Season pass') => ({ type: 'giveaway_winner', data: { username: 'RacerDan', prize } });
  const raid = (viewers = 42) => ({ type: 'raid', data: { username: 'GridWalker', viewers } });
  const bits = (amount) => ({ type: 'bits', data: { username: 'TurboTina', amount } });

  test('an alert nobody has given a look draws Glass\'s as it comes: its own speed and colour whatever an older builder saved, scaled to the saved width', () => {
    const overlay = loadOverlay({ styles: true, designs: { follow: design({ animation_speed: 1.8, screen_effect: 'confetti', card_width: 630 }) } });
    overlay.send(follow());
    const [slot] = overlay.slots();
    assert.match(slot.innerHTML, /^<div class="obj o-gl o-glf/);
    assert.equal(slot.style.properties['--spd'], '1', 'its own speed, not the 1.8 saved for today\'s card');
    assert.equal(slot.style.properties['--a'], undefined, 'its own colour');
    assert.ok(slot.classList.contains('look'));
    assert.equal(slot.style.properties['--zw'], '1.5', 'drawn for 420 px and scaled to the saved 630');
    assert.equal(slot.style.width, '630px');
  });

  test('the giveaway with no look is Glass\'s Spotlight; what was saved for the old card is not part of it', () => {
    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ bg_color: '#123456', accent_color: '#abcdef', event_label: 'And the winner is' }) } });
    overlay.send(giveaway());
    const [slot] = overlay.slots();
    assert.match(slot.innerHTML, /^<div class="obj o-gl o-glg"/);
    assert.ok(!slot.innerHTML.includes('#123456') && !slot.innerHTML.includes('And the winner is'));
    assert.ok(slot.classList.contains('playing'));
  });

  test('with no saved design at all every alert draws Glass\'s look', () => {
    const overlay = loadOverlay({ styles: true });
    for (const [event, cls] of [[giveaway(), 'o-glg'], [follow(), 'o-glf'], [raid(), 'o-glr'], [bits(500), 'o-glb']]) {
      overlay.send({ type: 'clear' });
      overlay.send(event);
      assert.match(overlay.slots()[0].innerHTML, new RegExp(`^<div class="obj o-gl ${cls}`), event.type);
    }
  });

  test('a picked look carries the streamer\'s colour with its shades, and its speed when it takes one', () => {
    const overlay = loadOverlay({ styles: true, designs: {
      follow: design({ style: 'follow-samurai', style_accent: '#29E0FF', animation_speed: 1.8 }),
      giveaway_winner: design({ style: 'giveaway-samurai', style_accent: '#29E0FF', style_label: 'Lucky draw', animation_speed: 1.5 }),
    } });
    overlay.send(follow());
    const [preset] = overlay.slots();
    assert.equal(preset.style.properties['--a'], '#29E0FF');
    assert.equal(preset.style.properties['--a-hi'], '#50E6FF');
    assert.equal(preset.style.properties['--a-on'], '#0B0B12');
    assert.equal(preset.style.properties['--spd'], undefined, 'today\'s looks keep their pace');
    overlay.send({ type: 'clear' });
    overlay.send(giveaway());
    const [omikuji] = overlay.slots();
    assert.equal(omikuji.style.properties['--spd'], '1.5');
    assert.equal(omikuji.style.properties['--a'], '#29E0FF');
    assert.ok(omikuji.innerHTML.includes('>Lucky draw<'), 'its main text');
  });

  test('a look of the styles is drawn for 420 px and scaled to the saved width; today\'s looks reflow', () => {
    const overlay = loadOverlay({ styles: true, designs: {
      raid: design({ style: 'raid-racing', card_width: 630 }), follow: design({ style: 'follow-samurai', card_width: 630 }),
    } });
    overlay.send(raid());
    const [look] = overlay.slots();
    assert.ok(look.classList.contains('look'));
    assert.equal(look.style.properties['--zw'], '1.5');
    assert.equal(look.style.width, '630px');
    overlay.send({ type: 'clear' });
    overlay.send(follow());
    assert.ok(!overlay.slots()[0].classList.contains('look'), 'the samurai presets are today\'s objects');
  });

  test('a look is handed the middle picture when "grows with the amount" is off, and the real amount in its words', () => {
    const lit = (html) => (html.match(/o-rcb-seg on/g) || []).length;
    const shown = (style_grows, amount) => {
      const overlay = loadOverlay({ styles: true, designs: { bits: design({ style: 'bits-racing', style_grows }) } });
      overlay.send(bits(amount));
      return overlay.slots()[0].innerHTML;
    };
    assert.ok(lit(shown(1, 10000)) > lit(shown(1, 500)));
    assert.equal(lit(shown(0, 10000)), lit(shown(1, 500)));
    assert.ok(shown(0, 10000).includes('<i>1</i>'), 'the odometer still rolls to the real 10,000');
  });

  test('a look stays at least its entrance plus a second, at its speed, even when the duration is shorter', () => {
    const overlay = loadOverlay({ styles: true, designs: { raid: design({ style: 'raid-racing', animation_speed: 2 }) } });
    overlay.send({ type: 'config-update', config: baseConfig({ raid: { enabled: true, duration: 1 } }) });
    overlay.send(raid(42));
    const [slot] = overlay.slots();
    // raid-racing's entrance: 0.9 s + 0.06 s a car, 12 cars, at speed 2: 0.81 s, plus a second
    overlay.clock.advance(1800);
    assert.ok(slot.classList.contains('playing'), 'still on screen');
    overlay.clock.advance(20);
    assert.ok(slot.classList.contains('exiting'), 'then it leaves');
  });

  test('a slowed look stays until its exit has run: Racing at speed 0.5 leaves in 0.72 s, its 0.36 s at half speed', () => {
    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing', animation_speed: 0.5 }) } });
    overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: true, duration: 5 } }) });
    overlay.send(follow());
    overlay.clock.advance(5000);
    const [slot] = overlay.slots();
    assert.ok(slot.classList.contains('exiting'), 'it leaves after its 5 s');
    overlay.clock.advance(719);
    assert.equal(overlay.slots().length, 1, 'still leaving');
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 0);
  });

  test('today\'s objects (the looks did not load) keep the streamer\'s duration as it is', () => {
    const overlay = loadOverlay({ kit: true, styles: false });
    overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: true, duration: 1 } }) });
    overlay.send(follow());
    overlay.clock.advance(1000);
    assert.ok(overlay.slots()[0].classList.contains('exiting'));
  });

  test('a look this page does not know draws the alert\'s default look', () => {
    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style: 'giveaway-nope' }), follow: design({ style: 'follow-nope' }) } });
    overlay.send(giveaway());
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-gl o-glg"/);
    overlay.send({ type: 'clear' });
    overlay.send(follow());
    assert.match(overlay.slots()[0].innerHTML, /^<div class="obj o-gl o-glf/);
  });

  test('when the joined looks did not load, the giveaway is today\'s card and the five are their objects', () => {
    const overlay = loadOverlay({ kit: true, styles: false, designs: { follow: design({ style: 'follow-racing' }) } });
    overlay.send(giveaway());
    assert.ok(overlay.slots()[0].children.some((c) => c.classList.contains('alert-card')), 'the legacy card');
    overlay.send({ type: 'clear' });
    overlay.send(follow());
    assert.match(overlay.slots()[0].innerHTML, /^<div class="obj o-follow/);
  });

  test('a look that throws while drawing falls back to the alert\'s own object, or its card, and says so once', () => {
    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing' }) } });
    overlay.run("window.ATLETA_OBJECT_STYLES['follow-racing'].render = () => { throw new Error('boom'); }");
    overlay.run("window.ATLETA_OBJECT_STYLES['giveaway-glass'].render = () => { throw new Error('boom'); }");
    overlay.send(follow());
    assert.match(overlay.slots()[0].innerHTML, /^<div class="obj o-follow/);
    overlay.send({ type: 'clear' });
    overlay.send(follow());
    overlay.send({ type: 'clear' });
    overlay.send(giveaway());
    assert.ok(overlay.slots()[0].children.some((c) => c.classList.contains('alert-card')));
    assert.equal(overlay.errors.filter((e) => e.includes('follow-racing')).length, 1, 'once per look');
    assert.equal(overlay.errors.filter((e) => e.includes('giveaway-glass')).length, 1);
  });
});

describe('the screen effect and the sound of a look (alert styles)', () => {
  const giveaway = () => ({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Season pass' } });
  const effects = (overlay, cls) => overlay.container.children.filter((c) => c.classList.contains(cls)).length;
  const all = (overlay) => overlay.container.children.filter((c) => c.classList.contains('screen-effect')).length;
  // Which sound played: today's synthesized one or a look's, replaced by markers.
  const listen = (overlay) => {
    overlay.run("window.played = []; soundEffects.follow = () => window.played.push('today:follow'); soundEffects.giveaway_winner = () => window.played.push('today:giveaway');");
    for (const [key, family] of [['rcVictory', 'racing'], ['rcFlyby', 'racing'], ['samuraiBell', 'samurai'], ['glFollow', 'glass'], ['glGiveaway', 'glass']]) {
      overlay.run(`window.ATLETA_KIT.registerSound('${key}', '${family}', () => window.played.push('${key}'))`);
    }
    return () => JSON.parse(overlay.run('JSON.stringify(window.played)')); // an array of this realm
  };

  test('the overlay starts loading the recordings its six alerts will play when the designs arrive', () => {
    const overlay = loadOverlay({ styles: true });
    overlay.run('window.preloaded = []; window.ATLETA_KIT.preloadSounds = (keys) => window.preloaded.push(keys.slice());');
    overlay.send({ type: 'config-update', designs: { follow: design({ style: 'follow-racing' }), raid: design({ style: 'raid-racing', style_sound: 'rcConvoy.2' }) } });
    assert.deepEqual(JSON.parse(overlay.run('JSON.stringify(window.preloaded)')), [['rcFlyby', 'glSub', 'glBits', 'glDonation', 'rcConvoy.2', 'glGiveaway']]);
  });

  test('an alert nobody has given a look plays Glass\'s own effect and sound, whatever an older builder saved', () => {
    const overlay = loadOverlay({ styles: true, designs: { follow: design({ screen_effect: 'confetti' }) } });
    const played = listen(overlay);
    overlay.send(follow());
    assert.equal(all(overlay), 0, 'Pill has no effect of its own; the confetti saved for today\'s card is not played');
    assert.deepEqual(played(), ['glFollow']);
  });

  test('a picked look plays the effect its design names, or its own, and its own sound', () => {
    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing', screen_effect: 'default' }), raid: design({ style: 'raid-racing', screen_effect: 'sparks' }) } });
    const played = listen(overlay);
    overlay.send(follow());
    assert.equal(all(overlay), 0, 'Fly-by has no effect of its own');
    assert.deepEqual(played(), ['rcFlyby']);
    overlay.send({ type: 'clear' });
    overlay.send({ type: 'raid', data: { username: 'GridWalker', viewers: 42 } });
    assert.equal(effects(overlay, 'fx-spark'), 56);
  });

  test('the giveaway with no look plays Spotlight\'s confetti and its sound; an effect saved for the old card does not carry over', () => {
    const fresh = loadOverlay({ styles: true });
    const played = listen(fresh);
    fresh.send(giveaway());
    assert.ok(effects(fresh, 'confetti') > 0);
    assert.deepEqual(played(), ['glGiveaway']);
    const saved = loadOverlay({ styles: true, designs: { giveaway_winner: design({ screen_effect: 'gold' }) } });
    saved.send(giveaway());
    assert.equal(effects(saved, 'gold-item'), 0, 'no gold rain');
    assert.ok(effects(saved, 'confetti') > 0, 'Spotlight\'s own confetti');
  });

  test('an alert with no look plays its effect at the look\'s own speed, not one saved for the old card; the saved amount stays, as the builder shows it', () => {
    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ animation_speed: 1.8, effect_amount: 0.5 }) } });
    overlay.send(giveaway());
    const confetti = overlay.container.children.filter((c) => c.classList.contains('confetti'));
    assert.equal(confetti.length, 30, 'half of 60 pieces');
    assert.ok(confetti.every((c) => parseFloat(c.style.animationDuration) >= 2), 'speed 1: 2 to 4 s a piece, not 1.1 to 2.2');
  });

  test('a picked Victory lap plays its chequered confetti and its fanfare', () => {
    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style: 'giveaway-racing', screen_effect: 'default' }) } });
    const played = listen(overlay);
    overlay.send(giveaway());
    assert.equal(effects(overlay, 'fx-check'), 60);
    assert.deepEqual(played(), ['rcVictory']);
  });

  test('the design\'s sound wins over the look\'s; "none" is silence; an unknown one is the look\'s own', () => {
    for (const [style_sound, expected] of [['samuraiBell', ['samuraiBell']], ['today', ['today:giveaway']], ['none', []], ['nope', ['rcVictory']]]) {
      const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style: 'giveaway-racing', style_sound }) } });
      const played = listen(overlay);
      overlay.send(giveaway());
      assert.deepEqual(played(), expected, style_sound);
    }
  });

  test('a sound the streamer uploaded still plays first, even over "none"', () => {
    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style: 'giveaway-racing', style_sound: 'none' }) } });
    overlay.send({ type: 'config-update', config: baseConfig({ sounds: { giveaway_winner: '/overlay/sounds/test-token/giveaway_winner?v=1' } }) });
    const played = listen(overlay);
    overlay.send(giveaway());
    assert.equal(overlay.audio.instances.length, 1);
    assert.ok(overlay.audio.instances[0].played);
    assert.deepEqual(played(), []);
  });

  test('the looks\' sounds use the overlay\'s AudioContext and volume', () => {
    const overlay = loadOverlay({ styles: true });
    const before = overlay.audio.oscillators;
    overlay.send(giveaway());
    assert.ok(overlay.audio.oscillators > before, 'Victory lap was played through the page\'s AudioContext');
    overlay.send({ type: 'config-update', config: baseConfig({ volume: 0 }) });
    overlay.send({ type: 'clear' });
    const muted = overlay.audio.oscillators;
    overlay.send(giveaway());
    assert.equal(overlay.audio.oscillators, muted, 'volume 0 is silent');
  });

  test('a legacy card can play one of the new effects too', () => {
    const overlay = loadOverlay({ styles: true, designs: { yt_member: design({ screen_effect: 'smoke' }) } });
    overlay.send({ type: 'yt_member', data: { username: 'NewMember42', level: 'Member' } });
    assert.equal(effects(overlay, 'fx-smoke'), 20);
  });
});

describe('the fonts of the looks (alert styles)', () => {
  const giveaway = () => ({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Season pass' } });
  const fontLinks = (overlay) => overlay.sandbox.document.head.children.filter((c) => /fonts\.googleapis\.com/.test(c.href || ''));
  // A browser's FontFaceSet: load() resolves when the test says so.
  const fontSet = () => {
    const waiting = [];
    return { waiting, load: () => new Promise((resolve) => waiting.push(resolve)) };
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  test('each family a design names, and the default looks\' (Glass), is asked for once, on connecting and on each update', () => {
    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing' }) } });
    assert.equal(fontLinks(overlay).length, 2, 'Racing for the follow\'s look, Glass once for the six default looks');
    assert.match(fontLinks(overlay)[0].href, /family=Kanit:ital,wght@0,800;0,900;1,800;1,900&family=Barlow\+Condensed:[^&]+&display=swap$/);
    assert.match(fontLinks(overlay)[1].href, /family=DM\+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Manrope:wght@500;700;800&display=swap$/);
    overlay.send({ type: 'config-update', designs: { giveaway_winner: design({ style: 'giveaway-samurai' }) } });
    overlay.send({ type: 'config-update', designs: { giveaway_winner: design({ style: 'giveaway-samurai' }) } });
    assert.equal(fontLinks(overlay).length, 3);
    assert.match(fontLinks(overlay)[2].href, /family=Noto\+Serif\+JP:wght@700&display=swap$/);
  });

  test('the first alert in a look waits for its fonts, at most 1.5 s, then plays with the fallbacks', () => {
    const overlay = loadOverlay({ styles: true });
    overlay.sandbox.document.fonts = fontSet();
    overlay.send(giveaway());
    assert.equal(overlay.slots().length, 0, 'waiting for its fonts');
    overlay.clock.advance(1499);
    assert.equal(overlay.slots().length, 0);
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 1);
  });

  test('fonts that arrive in time start it at once, and the next alert in that look does not wait', async () => {
    const overlay = loadOverlay({ styles: true });
    const fonts = fontSet();
    overlay.sandbox.document.fonts = fonts;
    overlay.send(giveaway());
    fontLinks(overlay)[0].onload();
    await settle();
    fonts.waiting.forEach((resolve) => resolve([]));
    await settle();
    assert.equal(overlay.slots().length, 1, 'before the 1.5 s were up');
    overlay.send({ type: 'clear' });
    overlay.send(giveaway());
    assert.equal(overlay.slots().length, 1, 'at once');
  });

  test('Clear All while a first alert waits for its fonts: it never shows', () => {
    const overlay = loadOverlay({ styles: true });
    overlay.sandbox.document.fonts = fontSet();
    overlay.send(giveaway());
    overlay.send({ type: 'clear' });
    overlay.clock.advance(5000);
    assert.equal(overlay.slots().length, 0);
  });

  test('today\'s objects (the looks did not load) and the cards never wait', () => {
    const overlay = loadOverlay({ kit: true, styles: false });
    overlay.sandbox.document.fonts = fontSet();
    overlay.send(follow());
    assert.equal(overlay.slots().length, 1);
    overlay.send({ type: 'clear' });
    overlay.send({ type: 'yt_member', data: { username: 'NewMember42', level: 'Member' } });
    assert.equal(overlay.slots().length, 1, 'a card');
  });
});
