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

// Loads overlay.js (and, unless told not to, the object registry) into a fresh context.
function loadOverlay({ objects = true } = {}) {
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

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
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
  const context = vm.createContext(sandbox);
  if (objects) vm.runInContext(OBJECTS_JS, context, { filename: 'objects/index.js' });
  vm.runInContext(OVERLAY_JS, context, { filename: 'overlay.js' });

  const overlay = {
    clock, container, audio, sandbox, context,
    // Feed the overlay a message as the server's event stream would.
    send(message) { sources[sources.length - 1].onmessage({ data: JSON.stringify(message) }); },
    // Read or call anything the script declared at its top level.
    run(code) { return vm.runInContext(code, context); },
    slots() { return container.children.filter((c) => c.classList.contains('alert-pos')); },
  };
  overlay.send({ type: 'config', serverVersion: 'v1', designs: {}, config: baseConfig() });
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
