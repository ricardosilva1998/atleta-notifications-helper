'use strict';

// The Overlay Builder's alert cards (public/js/builder-cards.js): the loop that plays a look in a card,
// how a look is fitted to the card's width, an alert's working design and which cards the page shows.
// The page script is loaded under node:vm with a minimal fake element and the test's timers.

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'builder-cards.js'), 'utf8');
const CORE = require('../public/js/builder-styles-core.js');
const PLACEMENT = require('../public/overlay/placement.js');

// The page script in a context of its own; `globals` are what the view's inline script defines.
function load(globals = {}) {
  const context = vm.createContext({
    // Resolved at call time, so mock.timers' replacements are used.
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    ATLETA_BUILDER_STYLES: CORE,
    ATLETA_PLACEMENT: PLACEMENT,
    ATLETA_KIT: { lookData: (look, sample) => sample, slotVars: (look, d) => ({ '--spd': String(d.animation_speed || 1) }) },
    ...globals,
  });
  context.window = context;
  vm.runInContext(SOURCE, context);
  const cards = context.ATLETA_BUILDER_CARDS;
  Object.defineProperty(cards, '__context', { value: context });   // the test's handle on the page's globals
  return cards;
}

function element() {
  const classes = new Set();
  const props = {};
  return {
    innerHTML: '',
    offsetWidth: 420,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
    },
    style: {
      setProperty: (name, value) => { props[name] = String(value); },
      removeProperty: (name) => { delete props[name]; },
      getPropertyValue: (name) => props[name] || '',
    },
  };
}

// mock.timers.tick(n) moves the clock to the end before it runs what is due, so a timer set inside a callback
// would land late; this moves it one millisecond at a time, as a real clock does.
function advance(ms) { for (let i = 0; i < ms; i++) mock.timers.tick(1); }

const LOOK = {
  key: 'follow-glass', family: 'glass', eventType: 'follow', controls: { speed: true },
  anim: { in: 'x', dur: '1s', ease: 'linear' }, exit: { out: 'y', dur: '0.5s', ease: 'linear' },
  render: () => '<div class="obj"></div>',
};

describe('the loop', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  test('a loop plays the entrance, holds, plays the exit at the speed, pauses, and plays again', () => {
    const { Looper } = load();
    const slot = element();
    const plays = [];
    const lp = new Looper(slot, () => ({ look: LOOK, design: { animation_speed: 2 }, sample: { username: 'A' } }),
      { hold: 2000, gap: 700, onPlay: (look, design) => plays.push([look.key, design.animation_speed]) });
    lp.start();
    assert.ok(slot.classList.contains('playing'), 'plays at once');
    assert.equal(slot.innerHTML, '<div class="obj"></div>');
    assert.equal(slot.style.getPropertyValue('--in'), 'x');
    assert.equal(slot.style.getPropertyValue('--dur'), '1s');
    assert.equal(slot.style.getPropertyValue('--spd'), '2', 'the look\'s slot variables');
    assert.deepEqual(plays, [['follow-glass', 2]]);

    advance(2499);   // the entrance at speed 2 (500 ms) and the hold (2000 ms)
    assert.ok(!slot.classList.contains('exiting'));
    advance(1);
    assert.ok(slot.classList.contains('exiting'), 'the exit at 2500 ms');
    assert.equal(slot.style.getPropertyValue('--out'), 'y');
    assert.equal(slot.style.getPropertyValue('--outdur'), '0.5s');

    advance(449);    // the exit takes at least 400 ms (0.5 s at speed 2 is 250 ms), plus 50
    assert.notEqual(slot.innerHTML, '');
    advance(1);
    assert.equal(slot.innerHTML, '', 'empty once the exit has run');
    assert.ok(!slot.classList.contains('playing') && !slot.classList.contains('exiting'));

    advance(699);
    assert.ok(!slot.classList.contains('playing'));
    advance(1);
    assert.ok(slot.classList.contains('playing'), 'plays again after the pause');
    assert.equal(plays.length, 2);
    lp.stop();
  });

  test('a look that throws while drawing leaves the slot empty and the loop goes on', () => {
    const { Looper } = load();
    const slot = element();
    let draws = 0;
    const broken = { ...LOOK, render: () => { draws += 1; throw new Error('boom'); } };
    const lp = new Looper(slot, () => ({ look: broken, design: {}, sample: {} }), { hold: 2000, gap: 700 });
    assert.doesNotThrow(() => lp.start());
    assert.equal(slot.innerHTML, '');
    assert.ok(!slot.classList.contains('playing'));
    assert.equal(draws, 1);
    assert.doesNotThrow(() => advance(1000 + 2000 + 500 + 50 + 700));
    assert.equal(draws, 2, 'the next cycle came');
    assert.equal(slot.innerHTML, '');
    lp.stop();
  });

  test('stop() clears the slot and no timer fires afterwards', () => {
    const { Looper } = load();
    const slot = element();
    let draws = 0;
    const lp = new Looper(slot, () => ({ look: { ...LOOK, render: () => { draws += 1; return '<i></i>'; } }, design: {}, sample: {} }), {});
    lp.start();
    advance(100);
    lp.stop();
    assert.equal(slot.innerHTML, '');
    assert.ok(!slot.classList.contains('playing') && !slot.classList.contains('exiting'));
    advance(10000);
    assert.equal(draws, 1);
    assert.equal(slot.innerHTML, '');
  });

  test('an offset delays only the first play', () => {
    const { Looper } = load();
    const slot = element();
    let draws = 0;
    const lp = new Looper(slot, () => ({ look: { ...LOOK, render: () => { draws += 1; return '<i></i>'; } }, design: { animation_speed: 2 }, sample: {} }),
      { hold: 2000, gap: 700, offset: 900 });
    lp.start();
    assert.ok(!slot.classList.contains('playing'), 'nothing at 0');
    assert.equal(draws, 0);
    advance(899);
    assert.equal(draws, 0);
    advance(1);
    assert.ok(slot.classList.contains('playing'), 'plays at 900 ms');
    advance(2950 + 699);
    assert.equal(draws, 1);
    advance(1);
    assert.equal(draws, 2, 'the second play at its normal interval');
    assert.ok(slot.classList.contains('playing'));
    lp.stop();
  });

  test('the offset is for a loop\'s first start only: restart() and a later start() play at once', () => {
    const { Looper } = load();
    const slot = element();
    let draws = 0;
    const lp = new Looper(slot, () => ({ look: { ...LOOK, render: () => { draws += 1; return '<i></i>'; } }, design: {}, sample: {} }),
      { hold: 2000, gap: 700, offset: 900 });
    lp.start();
    advance(900);
    assert.equal(draws, 1);
    lp.restart();
    assert.equal(draws, 2, 'a picked tile plays again at once');
    assert.ok(slot.classList.contains('playing'));
    lp.stop();
    lp.start();
    assert.equal(draws, 3, 'a tile scrolled back in plays at once');
    lp.stop();
  });

  test('restart() plays again at once', () => {
    const { Looper } = load();
    const slot = element();
    let draws = 0;
    const lp = new Looper(slot, () => ({ look: { ...LOOK, render: () => { draws += 1; return '<i></i>'; } }, design: {}, sample: {} }), {});
    lp.start();
    advance(1500);
    lp.restart();
    assert.equal(draws, 2);
    assert.ok(slot.classList.contains('playing'));
    lp.stop();
  });
});

describe('fitting a look to a card', () => {
  test('a look of the styles is scaled with --zw; a Samurai preset is zoomed at 420 px', () => {
    const { fitAlert } = load();
    const slot = element();
    fitAlert(slot, { family: 'glass' }, 210);
    assert.ok(slot.classList.contains('look'));
    assert.equal(slot.style.width, '210px');
    assert.equal(slot.style.getPropertyValue('--zw'), '0.5');
    fitAlert(slot, { family: 'samurai', preset: true }, 210);
    assert.ok(!slot.classList.contains('look'));
    assert.equal(slot.style.width, '420px');
    assert.equal(slot.style.zoom, '0.5');
    assert.equal(slot.style.getPropertyValue('--zw'), '', 'no scale variable left over');
  });
});

describe('an alert\'s working design', () => {
  const EVENT_DEFAULTS = {
    follow: { card_width: 420, card_position: 'top-center', screen_effect: 'confetti', animation_speed: 1 },
    timed: { card_width: 500, sponsor_animation: 'fade' },
  };

  test('a stored row with a look is the design as stored, over the defaults', () => {
    const { designOf } = load({
      EVENT_DEFAULTS, ALERT_STYLES: { follow: 'follow-racing' },
      SERVER_DESIGNS: [{ event_type: 'follow', style: 'follow-racing', card_width: 600, screen_effect: 'smoke', animation_speed: 1.5 }],
    });
    const d = designOf('follow');
    assert.equal(d.card_width, 600);
    assert.equal(d.card_position, 'top-center');
    assert.equal(d.screen_effect, 'smoke');
    assert.equal(d.animation_speed, 1.5);
  });

  test('an alert with no look stored is shown with its default look\'s own settings; its place stays', () => {
    const { designOf } = load({
      EVENT_DEFAULTS, ALERT_STYLES: {},
      SERVER_DESIGNS: [{ event_type: 'follow', card_width: 600, card_position: 'bot-left', screen_effect: 'smoke', animation_speed: 1.5 }],
    });
    const d = designOf('follow');
    assert.deepEqual([d.card_width, d.card_position], [600, 'bot-left']);
    assert.deepEqual([d.screen_effect, d.animation_speed, d.style_sound], ['default', 1, null]);
  });

  test('a card without looks keeps its row; nothing stored is the defaults', () => {
    const { designOf } = load({ EVENT_DEFAULTS, ALERT_STYLES: {}, SERVER_DESIGNS: [] });
    assert.deepEqual({ ...designOf('timed') }, EVENT_DEFAULTS.timed);
  });
});

describe('the cards the page shows', () => {
  test('the six alerts and the sponsor images; the YouTube alerts only while YouTube is on', () => {
    const { shownCards } = load();
    assert.deepEqual([...shownCards({ youtube: false })], ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'timed']);
    assert.deepEqual([...shownCards({ youtube: true })], CORE.CARD_TYPES);
    assert.deepEqual([...shownCards(undefined)], ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'timed']);
  });

  test('every card the core lists has an icon', () => {
    const { CARD_ICONS } = load();
    for (const type of CORE.CARD_TYPES) assert.ok(CARD_ICONS[type], type);
  });
});

describe('a loop with nothing to play', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  test('a get() with no look stops the loop, so a later start() plays', () => {
    const { Looper } = load();
    const slot = element();
    let look = null;
    const lp = new Looper(slot, () => ({ look, design: {}, sample: {} }), {});
    lp.start();
    assert.equal(lp.running, false, 'not stuck as running');
    assert.ok(!slot.classList.contains('playing'));
    look = LOOK;
    lp.start();
    assert.ok(slot.classList.contains('playing'), 'the next start() plays');
    lp.stop();
  });
});

// ── The edit window ──
// A fake page: the window's elements by id (nothing else, so the cards are not drawn at load), elements
// that keep their children, attributes and listeners, and a document that takes keydown listeners.
const EDITOR_IDS = ['editor', 'editor-back', 'editor-icon', 'editor-title', 'editor-close', 'editor-tabs', 'editor-side',
  'editor-msg', 'editor-reset', 'editor-cancel', 'editor-done', 'stage', 'stage-inner', 'stage-bg', 'stage-slot', 'fx-layer',
  'stage-replay', 'stage-sound-loop',
  'pane-animation', 'pane-customize', 'pane-sound', 'pane-location', 'pane-images', 'pane-design',
  // the Animation and Customize tabs
  'anim-chips', 'anim-gallery', 'custom-preview', 'custom-slot', 'custom-nothing', 'custom-row-accent', 'custom-row-racing',
  'custom-row-label', 'custom-row-speed', 'custom-row-effect', 'custom-row-grows', 'style-accent', 'style-accent-own', 'style-accent-val',
  'style-racing-card', 'style-racing-accent', 'style-racing-name', 'style-racing-font', 'style-label', 'style-speed', 'val-style-speed',
  'style-effect', 'style-grows', 'custom-all-six',
  // the legacy cards: the page's card (and where it waits off the stage) and the sponsor rotation switch
  'preview-card-container', 'legacy-preview', 'sp-rotation-toggle'];

function fakeElement(doc, tag) {
  const el = element();
  const children = [];
  const attrs = {};
  const listeners = {};
  Object.assign(el, {
    tagName: String(tag || 'div').toUpperCase(), hidden: false, disabled: false, textContent: '', id: '',
    children,
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    appendChild(child) { children.push(child); return child; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, extra = {}) { (listeners[type] || []).forEach((fn) => fn({ target: el, currentTarget: el, preventDefault() {}, ...extra })); },
    focus() { doc.activeElement = el; },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
  });
  Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { children.length = 0; } });
  return el;
}
function fakeDocument() {
  const byId = {};
  const listeners = {};
  const doc = {
    activeElement: null,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => fakeElement(doc, tag),
    querySelector: () => null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, extra = {}) { (listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, ...extra })); },
  };
  EDITOR_IDS.forEach((id) => { byId[id] = fakeElement(doc, 'div'); byId[id].id = id; });
  ['editor', 'editor-back'].forEach((id) => { byId[id].hidden = true; });   // as the markup has them
  return doc;
}

const TEXTS = {
  'window.title': 'Edit the {{alert}} alert', 'window.leave': 'Close without saving your changes?', 'window.saving': 'Saving…',
  'window.done': 'Done', 'tabs.animation': 'Animation', 'tabs.customize': 'Customize', 'tabs.sound': 'Sound', 'tabs.location': 'Location',
  'tabs.images': 'Images', 'tabs.design': 'Design', 'cards.editSponsors': 'Edit sponsor images', 'cards.images': '{{count}} images',
  'cards.free': 'Free position', 'cards.uploaded': 'Your uploaded sound', 'sound.today': 'Classic engine sound', 'sound.none': 'No sound',
  'window.replay': 'Replay with sound', 'window.soundLoop': 'Sound on every loop',
  'place.fixed': 'Fixed spot', 'place.fixedHint': 'Pick one of nine places', 'place.free': 'Free position', 'place.freeHint': 'Drag it on the preview',
  'place.fixedNote': 'The alert sits 16 px from the edges.', 'place.freeNote': 'Drag the alert on the preview.', 'place.size': 'Size', 'place.width': '{{px}} px wide',
  'place.top': 'Top', 'place.mid': 'Middle', 'place.bot': 'Bottom', 'place.left': 'left', 'place.center': 'centre', 'place.right': 'right',
  resetConfirm: 'Reset "{{name}}" to default settings?', resetDone: 'Reset to default', saveFailed: 'Save failed', saveFailedWith: 'Save failed: {{error}}',
  'custom.nothing': 'This look has no settings of its own: pick its sound in the Sound tab.', 'custom.ownColour': 'Use the look\'s own',
  'custom.ownColours': 'The look\'s own colours', 'custom.allSix': 'Use {{family}} for all six alerts',
  'custom.allSixConfirm': 'Use {{family}} for all six alerts? Each alert starts this theme\'s look with its own settings.',
  'style.all': 'All', 'style.default': 'Default', 'style.mine': 'Made for you', 'style.failed': 'That did not work. Please try again.',
  'style.familyDone': '{{family}} is now on all six alerts, and saved.', 'style.labelHint': 'Empty: the look\'s own words',
  'style.fontOwn': 'The look\'s own font', 'style.testSent': 'Sent to OBS, which plays what you saved last.',
  'sound.thisLook': 'This look', 'sound.own': 'Own sound', 'sound.second': 'Version 2', 'sound.silent': 'Silent', 'sound.current': 'Current',
  'sound.search': 'Search sounds…', 'sound.both': 'both recordings', 'sound.listen': 'Listen',
  'sound.uploaded': 'You uploaded a sound for this alert, so OBS plays it instead of the look\'s sound.', 'sound.uploadedLink': 'Overlay settings',
  'style.listenToday': 'Today\'s sound plays in OBS: use Test to hear it.', 'window.replayPlain': 'Replay',
};
const GLASS = { ...LOOK, key: 'follow-glass', sound: 'glFollow' };
const RACING = { ...LOOK, key: 'follow-racing', family: 'racing', sound: 'rcFollow' };
const ARCADE = { ...LOOK, key: 'follow-arcade', family: 'arcade', sound: 'arFollow' };

// The page script with a fake page and the view's globals. `answers` are what fetch returns, in order;
// every call is kept in `calls`.
function loadPage({ saved = {}, rows = [], answers = [], confirmAnswer = true, features = {}, extra = {} } = {}) {
  const calls = [];
  const confirms = [];
  const document = fakeDocument();
  const g = {
    document,
    URLSearchParams,
    confirm: (q) => { confirms.push(q); return typeof confirmAnswer === 'function' ? confirmAnswer(q) : confirmAnswer; },
    fetch: (url, opts) => {
      calls.push({ url, opts });
      const answer = answers.shift() || { status: 200, body: { ok: true } };
      if (answer.pending) return answer.pending;
      return Promise.resolve({ ok: answer.status < 400, status: answer.status, json: () => Promise.resolve(answer.body) });
    },
    currentType: 'follow',
    SAVED_STYLES: { ...saved },
    ALERT_STYLES: { ...saved },
    SAVED_DESIGNS: {},
    SERVER_DESIGNS: rows.map((r) => ({ ...r })),
    EVENT_DEFAULTS: {
      follow: { card_width: 420, card_position: 'top-center', screen_effect: 'default', animation_speed: 1 },
      timed: { card_width: 500, card_position: 'bot-center', sponsor_animation: 'fade' },
      yt_member: { card_width: 420, card_position: 'top-center' },
    },
    STYLE_DATA: {
      looks: { 'follow-glass': { title: 'Pill' }, 'follow-racing': { title: 'Pit board' }, 'follow-arcade': { title: 'Coin' } },
      families: [], defaults: { follow: 'follow-glass' },
      sounds: [{ family: 'glass', sounds: [{ key: 'glFollow', name: 'Soft chime' }] }, { family: 'racing', sounds: [{ key: 'rcFollow', name: 'Air horn' }] }],
    },
    I18N: { eventNames: { follow: 'Follow', timed: 'Timed', yt_member: 'Member' } },
    sponsorImages: [{ filename: 'a.png', enabled: 1 }, { filename: 'b.png', enabled: 0 }],
    ATLETA_OBJECT_STYLES: { 'follow-glass': GLASS, 'follow-racing': RACING, 'follow-arcade': ARCADE },
    ATLETA_KIT: {
      lookData: (look, sample) => sample, slotVars: () => ({}),
      soundFor: (look, d) => (d && d.style_sound) || (look && look.sound) || 'none',
    },
    BUILDER: { features, uploadedSounds: {} },
    BUILDER_TEXTS: TEXTS,
    ...extra,
  };
  const CARDS = load(g);
  let renders = 0;
  CARDS.renderCards = () => { renders += 1; };
  return { CARDS, g, document, calls, confirms, renders: () => renders };
}
const isOpen = (document) => !document.getElementById('editor').hidden && !document.getElementById('editor-back').hidden;
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('the edit window', () => {
  test('opens on the first of its tabs, says which alert, and sets currentType for the page\'s legacy code', () => {
    const { CARDS, g, document } = loadPage({ saved: {} });
    CARDS.openEditor('follow');
    assert.ok(isOpen(document));
    assert.equal(CARDS.editing, 'follow');
    assert.equal(document.getElementById('editor-title').textContent, 'Edit the Follow alert');
    assert.equal(document.getElementById('editor-icon').textContent, CARDS.CARD_ICONS.follow);
    assert.equal(g.currentType, 'follow');
    assert.equal(CARDS.draftStyle, 'follow-glass', 'the alert\'s default look when none is stored');
    assert.equal(CARDS.tab, 'animation');
    const tabs = document.getElementById('editor-tabs').children;
    assert.deepEqual(tabs.map((b) => b.getAttribute('data-tab')), ['animation', 'customize', 'sound', 'location']);
    assert.deepEqual(tabs.map((b) => b.getAttribute('aria-selected')), ['true', 'false', 'false', 'false']);
    assert.equal(document.getElementById('pane-animation').hidden, false);
    for (const p of ['customize', 'sound', 'location', 'images', 'design']) assert.equal(document.getElementById('pane-' + p).hidden, true, p);
    assert.equal(document.getElementById('editor-side').hidden, true, 'no stage on Animation');
  });

  test('each tab shows its current value: the look, the sound, the place', () => {
    const { CARDS, document } = loadPage({ saved: {} });
    CARDS.openEditor('follow');
    assert.equal(CARDS.tabValue('animation'), 'Pill');
    assert.equal(CARDS.tabValue('customize'), '');
    assert.equal(CARDS.tabValue('sound'), 'Soft chime');
    assert.equal(CARDS.tabValue('location'), 'Top centre');
    CARDS.draft.card_custom_x = 0.2;
    CARDS.draft.card_custom_y = 0.3;
    CARDS.draftStyle = 'follow-racing';
    CARDS.renderTabValues();
    assert.equal(CARDS.tabValue('location'), 'Free position');
    assert.equal(CARDS.tabValue('animation'), 'Pit board');
    assert.equal(CARDS.tabValue('sound'), 'Air horn');
    const animationTab = document.getElementById('editor-tabs').children[0];
    assert.equal(animationTab.children[1].textContent, 'Pit board', 'the tab bar shows it');
  });

  test('the stage shows only on Location and Design; tabs switch their panes', () => {
    const { CARDS, document } = loadPage();
    CARDS.openEditor('follow');
    CARDS.setTab('location');
    assert.equal(document.getElementById('pane-location').hidden, false);
    assert.equal(document.getElementById('pane-animation').hidden, true);
    assert.equal(document.getElementById('editor-side').hidden, false);
    CARDS.setTab('sound');
    assert.equal(document.getElementById('editor-side').hidden, true);
    CARDS.setTab('images');
    assert.equal(CARDS.tab, 'sound', 'a tab the card does not have is ignored');
  });

  test('Done sends one save with the look the window shows, and closes on success', async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const { CARDS, g, document, calls, renders } = loadPage({ saved: { follow: 'follow-glass' }, rows: [{ event_type: 'follow', style: 'follow-glass', card_width: 500 }], answers: [{ pending }] });
    CARDS.openEditor('follow');
    CARDS.draftStyle = 'follow-racing';
    CARDS.draft.card_width = 640;
    const saving = CARDS.saveDraft();
    assert.equal(document.getElementById('editor-done').textContent, 'Saving…');
    assert.equal(document.getElementById('editor-done').disabled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/dashboard/overlay-builder/save');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.body, JSON.stringify(CORE.savePayload('follow', CARDS.draft, 'follow-racing')));
    resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    const result = await saving;
    assert.equal(result.ok, true);
    assert.equal(g.SAVED_STYLES.follow, 'follow-racing');
    assert.equal(g.ALERT_STYLES.follow, 'follow-racing');
    const row = g.SERVER_DESIGNS.find((r) => r.event_type === 'follow');
    assert.equal(row.style, 'follow-racing', 'the stored row is what was saved, so the card shows it');
    assert.equal(row.card_width, 640);
    assert.equal(g.SERVER_DESIGNS.length, 1);
    assert.ok(!isOpen(document), 'closed');
    assert.equal(CARDS.editing, null);
    assert.equal(renders(), 1, 'the cards are drawn again');
    assert.equal(document.getElementById('editor-done').textContent, 'Done');
    assert.equal(document.getElementById('editor-done').disabled, false);
  });

  test('the draft holds the design only: the look travels next to it, and the row\'s own columns stay out', async () => {
    const { CARDS, calls } = loadPage({ saved: { follow: 'follow-glass' }, rows: [{ id: 7, streamer_id: 3, event_type: 'follow', style: 'follow-glass', design_version: 2, created_at: 'x', card_width: 500 }] });
    CARDS.openEditor('follow');
    for (const column of ['id', 'streamer_id', 'event_type', 'style', 'design_version', 'created_at']) assert.ok(!(column in CARDS.draft), column);
    assert.equal(CARDS.draft.card_width, 500);
    await CARDS.saveDraft();
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.style, 'follow-glass');
    assert.ok(!('style' in body.design) && !('event_type' in body.design));
  });

  test('a save of an alert with no row adds one', async () => {
    const { CARDS, g } = loadPage({ saved: {} });
    CARDS.openEditor('follow');
    await CARDS.saveDraft();
    assert.deepEqual(g.SERVER_DESIGNS.map((r) => [r.event_type, r.style]), [['follow', 'follow-glass']]);
    assert.equal(g.SAVED_DESIGNS.follow.style, 'follow-glass');
  });

  test('a refused save keeps the window open with the route\'s message', async () => {
    const { CARDS, g, document } = loadPage({ saved: { follow: 'follow-glass' }, answers: [{ status: 400, body: { ok: false, error: 'Invalid field: card_width' } }] });
    CARDS.openEditor('follow');
    CARDS.draftStyle = 'follow-racing';
    const result = await CARDS.saveDraft();
    assert.deepEqual({ ...result }, { ok: false, error: 'Invalid field: card_width' });
    assert.ok(isOpen(document));
    assert.equal(CARDS.editing, 'follow');
    assert.equal(document.getElementById('editor-msg').textContent, 'Invalid field: card_width');
    assert.equal(g.SAVED_STYLES.follow, 'follow-glass');
    assert.equal(document.getElementById('editor-done').disabled, false);
  });

  test('a save with no answer keeps the window open and says so', async () => {
    const { CARDS, document } = loadPage();
    CARDS.openEditor('follow');
    CARDS.__context.fetch = () => Promise.reject(new Error('offline'));
    const result = await CARDS.saveDraft();
    assert.equal(result.ok, false);
    assert.ok(isOpen(document));
    assert.equal(document.getElementById('editor-msg').textContent, 'Save failed: offline');
  });

  test('closing with edits asks first; without edits it just closes', () => {
    let answer = false;
    const { CARDS, document, confirms } = loadPage({ confirmAnswer: () => answer });
    CARDS.openEditor('follow');
    assert.equal(CARDS.isDirty(), false);
    CARDS.draft.card_width = 700;
    assert.equal(CARDS.isDirty(), true);
    assert.equal(CARDS.closeEditor(), false);
    assert.ok(isOpen(document), 'still open');
    assert.deepEqual(confirms, ['Close without saving your changes?']);
    answer = true;
    assert.equal(CARDS.closeEditor(), true);
    assert.ok(!isOpen(document), 'closed');

    CARDS.openEditor('follow');
    CARDS.closeEditor();
    assert.ok(!isOpen(document));
    assert.equal(confirms.length, 2, 'no edits: no question');

    CARDS.openEditor('follow');
    CARDS.draftStyle = 'follow-racing';
    assert.equal(CARDS.isDirty(), true, 'another look is an edit');
    CARDS.closeEditor({ force: true });
    assert.equal(confirms.length, 2, 'force: no question');
  });

  test('while Done\'s save is on its way the window stays: Esc, Cancel, ✕, the backdrop and Reset wait for it', async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const { CARDS, g, document, calls, confirms } = loadPage({ saved: { follow: 'follow-glass' }, answers: [{ pending }] });
    CARDS.openEditor('follow');
    CARDS.draftStyle = 'follow-racing';
    const saving = CARDS.saveDraft();
    for (const id of ['editor-done', 'editor-reset', 'editor-cancel', 'editor-close']) assert.equal(document.getElementById(id).disabled, true, id);
    document.fire('keydown', { key: 'Escape' });
    document.getElementById('editor-cancel').fire('click');
    document.getElementById('editor-close').fire('click');
    document.getElementById('editor-back').fire('click');
    assert.equal(CARDS.closeEditor(), false);
    assert.deepEqual({ ...(await CARDS.resetDraft()) }, { ok: false });
    assert.deepEqual(confirms, [], 'no question: the save will land');
    assert.equal(calls.length, 1, 'no reset sent');
    assert.ok(isOpen(document));
    assert.equal(CARDS.editing, 'follow');
    CARDS.openEditor('timed');
    assert.equal(CARDS.editing, 'follow', 'no other card opens over it');
    resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    assert.equal((await saving).ok, true);
    assert.ok(!isOpen(document));
    assert.equal(g.SAVED_STYLES.follow, 'follow-racing');
    for (const id of ['editor-done', 'editor-reset', 'editor-cancel', 'editor-close']) assert.equal(document.getElementById(id).disabled, false, id);
  });

  test('a save that lands after its window was closed leaves the window open now alone', async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const { CARDS, g, document } = loadPage({ saved: { follow: 'follow-glass' }, answers: [{ pending }] });
    CARDS.openEditor('follow');
    CARDS.draftStyle = 'follow-racing';
    const saving = CARDS.saveDraft();
    CARDS.closeEditor({ force: true });   // only a forced close passes while saving
    CARDS.openEditor('timed');
    CARDS.draft.card_width = 640;
    resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    await saving;
    assert.equal(g.SAVED_STYLES.follow, 'follow-racing', 'the follow alert is stored');
    assert.equal(CARDS.editing, 'timed', 'the sponsor window stays open');
    assert.equal(CARDS.draft.card_width, 640, 'with its edits');
    assert.ok(isOpen(document));
  });

  test('the card loops stop while the window is open and the ones on screen start again when it closes', () => {
    let observed;   // the cards' observer (the first one made; the window's gallery makes its own)
    class FakeObserver {
      constructor(callback, options) { if (!observed) observed = { callback, options, targets: [] }; }
      observe(el) { observed.targets.push(el); }
      unobserve() {}
      disconnect() {}
    }
    const { CARDS, document } = loadPage({ extra: { IntersectionObserver: FakeObserver } });
    const looper = () => ({ starts: 0, stops: 0, start() { this.starts += 1; }, stop() { this.stops += 1; } });
    const [a, b, c] = [{}, {}, {}];
    const [la, lb, lc] = [looper(), looper(), looper()];
    CARDS.watch(a, la);
    CARDS.watch(b, lb);
    CARDS.watch(c, lc);
    assert.equal(observed.options.rootMargin, '80px');
    assert.ok('root' in observed.options, 'observed inside the cards\' scrolling page');
    observed.callback([{ target: a, isIntersecting: true }, { target: c, isIntersecting: false }]);
    assert.deepEqual([la.starts, lb.starts, lc.starts], [1, 0, 0]);

    CARDS.openEditor('follow');
    assert.ok(la.stops >= 1 && lb.stops >= 1, 'stopped');
    observed.callback([{ target: b, isIntersecting: true }]);
    assert.equal(lb.starts, 0, 'a card scrolled into view stays still behind the window');

    CARDS.closeEditor();
    assert.ok(!isOpen(document));
    assert.deepEqual([la.starts, lb.starts, lc.starts], [2, 1, 0], 'the cards on screen play again; the one off screen does not');
  });

  test('Esc, the close button, Cancel and the backdrop close the window', () => {
    const { CARDS, document } = loadPage();
    for (const close of [() => document.fire('keydown', { key: 'Escape' }), () => document.getElementById('editor-close').fire('click'),
      () => document.getElementById('editor-cancel').fire('click'), () => document.getElementById('editor-back').fire('click')]) {
      CARDS.openEditor('follow');
      close();
      assert.ok(!isOpen(document));
    }
  });

  test('a save sends the look the window shows next to the design; Cancel and Reset put back the saved look', async () => {
    // Cancel: a look picked in the window (and shown by a preview) is not kept.
    let page = loadPage({ saved: { follow: 'follow-glass' } });
    page.CARDS.openEditor('follow');
    page.g.ALERT_STYLES.follow = 'follow-racing';
    page.CARDS.draftStyle = 'follow-racing';
    page.CARDS.closeEditor();
    assert.equal(page.g.ALERT_STYLES.follow, 'follow-glass');
    assert.equal(page.g.SAVED_STYLES.follow, 'follow-glass');

    // Reset: the route, then the window shows the reset design in the saved look.
    page = loadPage({ saved: { follow: 'follow-arcade' }, rows: [{ event_type: 'follow', style: 'follow-arcade', card_width: 600 }] });
    page.CARDS.openEditor('follow');
    page.g.ALERT_STYLES.follow = 'follow-racing';
    page.CARDS.draftStyle = 'follow-racing';
    page.CARDS.draft.card_width = 700;
    const result = await page.CARDS.resetDraft();
    assert.equal(result.ok, true);
    assert.deepEqual(page.confirms, ['Reset "Follow" to default settings?']);
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].url, '/dashboard/overlay-builder/reset');
    assert.equal(page.calls[0].opts.body, JSON.stringify({ eventType: 'follow' }));
    assert.ok(isOpen(page.document), 'the window stays open');
    assert.equal(page.CARDS.draftStyle, 'follow-arcade', 'the look is kept');
    assert.equal(page.g.ALERT_STYLES.follow, 'follow-arcade');
    assert.equal(page.CARDS.draft.card_width, 420, 'the design is the defaults');
    assert.deepEqual({ ...page.g.SERVER_DESIGNS[0] }, { event_type: 'follow', style: 'follow-arcade' });
    assert.equal(page.CARDS.isDirty(), false, 'what the window shows is what is stored');
    assert.equal(page.document.getElementById('editor-msg').textContent, 'Reset to default');
    assert.equal(page.renders(), 1);
  });

  test('Reset of an alert with no stored look removes its row; a declined Reset sends nothing', async () => {
    let page = loadPage({ saved: {}, rows: [{ event_type: 'follow', card_width: 600 }] });
    page.CARDS.openEditor('follow');
    await page.CARDS.resetDraft();
    assert.deepEqual(page.g.SERVER_DESIGNS, []);
    assert.equal(page.CARDS.draftStyle, 'follow-glass');

    page = loadPage({ confirmAnswer: false });
    page.CARDS.openEditor('follow');
    const result = await page.CARDS.resetDraft();
    assert.equal(result.ok, false);
    assert.equal(page.calls.length, 0);
  });

  test('?tab=timed opens the sponsor images window; ?tab=yt_member does not while YouTube is off', () => {
    let page = loadPage();
    assert.equal(page.CARDS.openFromUrl('?tab=timed'), 'timed');
    assert.equal(page.CARDS.editing, 'timed');
    assert.ok(isOpen(page.document));
    assert.equal(page.document.getElementById('editor-title').textContent, 'Edit sponsor images');
    assert.equal(page.CARDS.draftStyle, null, 'no look for the sponsor images');
    assert.deepEqual(page.document.getElementById('editor-tabs').children.map((b) => b.getAttribute('data-tab')), ['images', 'design', 'location']);
    assert.equal(page.CARDS.tabValue('images'), '2 images');

    page = loadPage();
    assert.equal(page.CARDS.openFromUrl('?tab=yt_member'), null);
    assert.ok(!isOpen(page.document));
    assert.equal(page.CARDS.openFromUrl('?tab=nope'), null);
    assert.equal(page.CARDS.openFromUrl(''), null);

    page = loadPage({ features: { youtube: true } });
    assert.equal(page.CARDS.openFromUrl('?tab=yt_member'), 'yt_member');
  });
});

// ── The Animation and Customize tabs ──
// The real looks and galleries where the order or a look's controls matter (the server's galleryFor, which loads
// every family and the C1 into the kit); the stub looks above where a look has to play.
const KIT = require('../public/overlay/objects/kit.js');
const ALERT_STYLE_SERVICE = require('../src/services/alertStyles.js');

// Every text of an element and of everything in it, in order.
function textOf(node) { return [node.textContent || ''].concat((node.children || []).map(textOf)).join(' ').replace(/\s+/g, ' ').trim(); }
const children = (document, id) => document.getElementById(id).children;

// What the server hands the page (routes/dashboard.js builderStyleData), with each title and family named by its id.
function realStyleData(streamer) {
  const gallery = {};
  const looks = {};
  for (const type of ALERT_STYLE_SERVICE.ALERTS) {
    gallery[type] = ALERT_STYLE_SERVICE.galleryFor(type, streamer);
    for (const { id } of gallery[type]) looks[id] = { title: id };
  }
  return {
    defaults: ALERT_STYLE_SERVICE.DEFAULT_STYLES, gallery, looks, sounds: [], fonts: ['System Default', 'Inter'],
    families: ALERT_STYLE_SERVICE.familyKeys().map((key) => ({ key, name: key[0].toUpperCase() + key.slice(1) })),
  };
}
function realPage(options = {}) {
  const defaults = {};
  for (const type of ALERT_STYLE_SERVICE.ALERTS) defaults[type] = { card_width: 420, card_position: 'top-center', screen_effect: 'default', animation_speed: 1 };
  return loadPage({
    ...options,
    extra: {
      STYLE_DATA: realStyleData(options.streamer || {}), ATLETA_OBJECT_STYLES: KIT.styles, ATLETA_KIT: KIT,
      EVENT_DEFAULTS: defaults, ...(options.extra || {}),
    },
  });
}
// An IntersectionObserver the test drives: `fire(target, on)` says a tile came on or left the screen.
function fakeObserver() {
  const made = [];
  class FakeObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; this.disconnected = false; made.push(this); }
    observe(el) { this.targets.push(el); }
    unobserve(el) { this.targets = this.targets.filter((t) => t !== el); }
    disconnect() { this.disconnected = true; this.targets = []; }
    fire(target, on) { this.callback([{ target, isIntersecting: on }]); }
  }
  return { FakeObserver, made, last: () => made[made.length - 1] };
}

describe('the Animation tab', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  test('the gallery lists this alert\'s looks only, made-for-you first, then the default, the C1 with your name, then the families', () => {
    const io = fakeObserver();
    const page = realPage({ streamer: { twitch_user_id: '632557806' }, extra: { IntersectionObserver: io.FakeObserver } });
    page.CARDS.openEditor('donation');
    assert.equal(page.CARDS.tab, 'animation');
    const ids = children(page.document, 'anim-gallery').map((tile) => tile.getAttribute('data-look'));
    assert.equal(ids[0], 'donation-c1');
    assert.equal(ids[1], 'donation-glass');
    const c1 = ids.indexOf('donation-c1-channel');
    assert.ok(c1 > 1, 'the C1 with your name is listed');
    ids.forEach((id, i) => { if (id.startsWith('donation-') && !['donation-c1', 'donation-c1-channel', 'donation-glass'].includes(id)) assert.ok(c1 < i, id); });
    assert.equal(ids.length, page.g.STYLE_DATA.gallery.donation.length, 'every look of the gallery has its tile');
    const tiles = children(page.document, 'anim-gallery');
    assert.match(textOf(tiles[0]), /Made for you/);
    assert.match(textOf(tiles[1]), /Default/);
    assert.match(textOf(tiles[1]), /Glass/, 'the theme');
    assert.match(textOf(tiles[1]), new RegExp(page.CARDS.CARD_ICONS.donation), 'the alert\'s badge');
    assert.equal(tiles[0].getAttribute('aria-pressed'), 'false');
    assert.equal(tiles[1].getAttribute('aria-pressed'), 'true', 'the look the window shows (the default: none is stored)');
    page.CARDS.closeEditor({ force: true });

    page.CARDS.openEditor('follow');
    const follow = children(page.document, 'anim-gallery').map((tile) => tile.getAttribute('data-look'));
    const allowed = page.g.STYLE_DATA.gallery.follow.map((e) => e.id);
    assert.ok(follow.length > 0);
    for (const id of follow) assert.ok(allowed.includes(id), id + ' belongs to the follow alert');
    assert.ok(!follow.includes('donation-c1-channel'));
    page.CARDS.closeEditor({ force: true });
  });

  test('theme chips: all, then each family that has a look for this alert, in the families\' order; a chip filters the gallery', () => {
    const io = fakeObserver();
    const page = realPage({ extra: { IntersectionObserver: io.FakeObserver } });
    page.CARDS.openEditor('donation');
    const chips = children(page.document, 'anim-chips');
    assert.equal(chips[0].textContent, 'All');
    assert.deepEqual(chips.slice(1).map((c) => c.getAttribute('data-family')), ALERT_STYLE_SERVICE.familyKeys(), 'the C1 has no theme of its own');
    assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
    const racing = chips.find((c) => c.getAttribute('data-family') === 'racing');
    racing.fire('click');
    assert.deepEqual(children(page.document, 'anim-gallery').map((t) => t.getAttribute('data-look')), ['donation-racing']);
    assert.equal(children(page.document, 'anim-chips').find((c) => c.getAttribute('data-family') === 'racing').getAttribute('aria-pressed'), 'true');
    page.CARDS.closeEditor({ force: true });
    page.CARDS.openEditor('donation');
    assert.ok(children(page.document, 'anim-gallery').length > 1, 'a new window shows every theme again');
    page.CARDS.closeEditor({ force: true });
  });

  test('a tile loops only while it is on screen, its start a little apart from its neighbours\', and stops with the tab', () => {
    const io = fakeObserver();
    const page = loadPage({
      saved: { follow: 'follow-glass' },
      extra: {
        IntersectionObserver: io.FakeObserver,
        STYLE_DATA: {
          looks: { 'follow-glass': { title: 'Pill' }, 'follow-racing': { title: 'Pit board' }, 'follow-arcade': { title: 'Coin' } },
          families: [{ key: 'glass', name: 'Glass' }, { key: 'racing', name: 'Racing' }, { key: 'arcade', name: 'Arcade' }],
          defaults: { follow: 'follow-glass' }, sounds: [],
          gallery: { follow: [{ id: 'follow-glass', family: 'glass' }, { id: 'follow-racing', family: 'racing' }, { id: 'follow-arcade', family: 'arcade' }] },
        },
      },
    });
    page.CARDS.openEditor('follow');
    const observer = io.last();
    const tiles = children(page.document, 'anim-gallery');
    assert.equal(observer.targets.length, 3, 'every tile is watched');
    const slotOf = (tile) => tile.children[0].children.find((c) => c.className === 'mini-slot');
    for (const tile of tiles) assert.ok(!slotOf(tile).classList.contains('playing'), 'nothing plays before it is seen');
    observer.fire(tiles[0], true);
    observer.fire(tiles[1], true);
    assert.ok(slotOf(tiles[0]).classList.contains('playing'), 'the first tile plays at once');
    assert.ok(!slotOf(tiles[1]).classList.contains('playing'), 'the second waits');
    advance(450);
    assert.ok(slotOf(tiles[1]).classList.contains('playing'), 'and starts 450 ms later');
    assert.ok(!slotOf(tiles[2]).classList.contains('playing'), 'off screen: still');
    observer.fire(tiles[0], false);
    assert.ok(!slotOf(tiles[0]).classList.contains('playing'), 'a tile that leaves the screen stops');

    page.CARDS.setTab('customize');
    assert.ok(observer.disconnected, 'the tab\'s observer is gone');
    for (const tile of tiles) assert.equal(slotOf(tile).innerHTML, '', 'every tile is stopped');
    page.CARDS.setTab('animation');
    const again = io.last();
    assert.notEqual(again, observer);
    again.fire(children(page.document, 'anim-gallery')[0], true);
    page.CARDS.closeEditor({ force: true });
    assert.ok(again.disconnected, 'closing the window stops the gallery');
  });

  test('picking a look starts its settings afresh and keeps where it sits', () => {
    const io = fakeObserver();
    const sounds = [];
    class FakeAudio { constructor() { this.state = 'running'; } resume() {} }
    const kit = {
      lookData: (look, sample) => sample, slotVars: () => ({}),
      soundFor: (look, d) => (d && d.style_sound) || (look && look.sound) || 'none',
      setAudio() {}, playSound: (key) => sounds.push(key),
    };
    const page = loadPage({
      saved: { follow: 'follow-glass' },
      extra: {
        IntersectionObserver: io.FakeObserver, AudioContext: FakeAudio, ATLETA_KIT: kit,
        STYLE_DATA: {
          looks: { 'follow-glass': { title: 'Pill' }, 'follow-racing': { title: 'Pit board' } }, families: [], sounds: [],
          defaults: { follow: 'follow-glass' }, gallery: { follow: [{ id: 'follow-glass', family: 'glass' }, { id: 'follow-racing', family: 'racing' }] },
        },
      },
    });
    page.CARDS.openEditor('follow');
    Object.assign(page.CARDS.draft, { style_accent: '#FF0000', animation_speed: 1.5, card_position: 'bot-left' });
    page.CARDS.pickLook('follow-racing');
    assert.equal(page.CARDS.draft.style_accent, null);
    assert.equal(page.CARDS.draft.animation_speed, 1);
    assert.equal(page.CARDS.draft.card_position, 'bot-left');
    assert.equal(page.CARDS.draftStyle, 'follow-racing');
    assert.equal(page.g.ALERT_STYLES.follow, 'follow-racing', 'the page shows it while the window is open');
    assert.deepEqual(sounds, ['rcFollow'], 'its sound plays once');
    assert.equal(page.CARDS.tabValue('animation'), 'Pit board');
    assert.deepEqual(children(page.document, 'anim-gallery').map((t) => t.getAttribute('aria-pressed')), ['false', 'true']);

    // A click on a tile picks it too; a look of another alert never does.
    children(page.document, 'anim-gallery')[0].fire('click');
    assert.equal(page.CARDS.draftStyle, 'follow-glass');
    page.g.ATLETA_OBJECT_STYLES['bits-x'] = { ...LOOK, key: 'bits-x', eventType: 'bits' };
    page.CARDS.pickLook('bits-x');
    assert.equal(page.CARDS.draftStyle, 'follow-glass');
    page.CARDS.closeEditor({ force: true });
    assert.equal(page.g.ALERT_STYLES.follow, 'follow-glass', 'Cancel puts the saved look back');
  });
});

describe('the Customize tab', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  const ROWS = ['accent', 'racing', 'label', 'speed', 'effect', 'grows'];
  const shown = (document) => ROWS.filter((row) => !document.getElementById('custom-row-' + row).hidden);

  test('Customize shows only what the picked look takes', () => {
    const page = realPage({ saved: { donation: 'donation-c1-channel', raid: 'raid-racing' } });
    const { CARDS, document } = page;
    CARDS.openEditor('follow');
    CARDS.setTab('customize');
    assert.deepEqual(shown(document), ['accent', 'label', 'speed', 'effect'], 'follow-glass: colour, main text, speed, effect; no grows');
    assert.equal(document.getElementById('custom-nothing').hidden, true);
    assert.equal(document.getElementById('custom-all-six').hidden, false);
    assert.equal(document.getElementById('custom-all-six').textContent, 'Use Glass for all six alerts');
    assert.equal(document.getElementById('style-accent-val').textContent, 'The look\'s own colours');
    assert.equal(document.getElementById('style-accent-own').hidden, true, 'nothing to go back to');
    assert.equal(document.getElementById('style-label').getAttribute('placeholder'), 'Empty: the look\'s own words');
    CARDS.closeEditor({ force: true });

    CARDS.openEditor('bits');
    CARDS.setTab('customize');
    assert.deepEqual(shown(document), ['accent', 'label', 'speed', 'effect', 'grows'], 'bits-glass: grows with the amount too');
    assert.equal(document.getElementById('style-grows').checked, true);
    CARDS.closeEditor({ force: true });

    CARDS.openEditor('raid');
    CARDS.setTab('customize');
    assert.deepEqual(shown(document), ['racing', 'label', 'speed', 'effect', 'grows'], 'Racing: its card, accent and name colours and font');
    CARDS.closeEditor({ force: true });

    CARDS.openEditor('donation');
    CARDS.setTab('customize');
    assert.deepEqual(shown(document), [], 'the C1 with your name: nothing');
    assert.equal(document.getElementById('custom-nothing').hidden, false);
    assert.equal(document.getElementById('custom-nothing').textContent, TEXTS['custom.nothing']);
    assert.equal(document.getElementById('custom-all-six').hidden, true, 'no theme to use for all six');
    CARDS.closeEditor({ force: true });
  });

  test('a change goes into the draft; the colour applies at once, the rest replays the look', () => {
    const page = realPage({ saved: { raid: 'raid-racing' } });
    const { CARDS, document } = page;
    const slot = document.getElementById('custom-slot');
    CARDS.openEditor('follow');
    CARDS.setTab('customize');
    assert.ok(slot.classList.contains('playing'), 'the picked look loops beside the controls');
    assert.ok(slot.classList.contains('look'), 'drawn for 420 px and scaled');

    document.getElementById('style-accent').value = '#00ff00';
    document.getElementById('style-accent').fire('input');
    assert.equal(CARDS.draft.style_accent, '#00FF00');
    assert.equal(slot.style.getPropertyValue('--a'), KIT.slotVars(KIT.styles['follow-glass'], { style_accent: '#00FF00' })['--a'], 'the colour applies at once');
    assert.equal(document.getElementById('style-accent-val').textContent, '#00FF00');
    assert.equal(document.getElementById('style-accent-own').hidden, false);
    document.getElementById('style-accent-own').fire('click');
    assert.equal(CARDS.draft.style_accent, null, 'the look\'s own colour');

    advance(1200);   // the look has entered and holds
    document.getElementById('style-speed').value = '1.5';
    document.getElementById('style-speed').fire('input');
    assert.equal(CARDS.draft.animation_speed, 1.5);
    assert.equal(document.getElementById('val-style-speed').textContent, '1.5×');
    document.getElementById('style-speed').fire('change');
    assert.equal(slot.style.getPropertyValue('--spd'), '1.5', 'played again at the new speed');

    document.getElementById('style-label').value = 'Welcome!';
    document.getElementById('style-label').fire('input');
    assert.equal(CARDS.draft.style_label, 'Welcome!');
    document.getElementById('style-effect').value = 'sparks';
    document.getElementById('style-effect').fire('change');
    assert.equal(CARDS.draft.screen_effect, 'sparks');
    assert.equal(CARDS.isDirty(), true);
    CARDS.closeEditor({ force: true });
    assert.equal(slot.innerHTML, '', 'the preview stops with the window');

    CARDS.openEditor('raid');
    CARDS.setTab('customize');
    document.getElementById('style-label').value = 'Pit crew!';
    document.getElementById('style-label').fire('input');
    assert.equal(CARDS.draft.event_label, 'Pit crew!', 'Racing\'s main text is today\'s event_label');
    document.getElementById('style-racing-card').value = '#112233';
    document.getElementById('style-racing-card').fire('input');
    assert.equal(CARDS.draft.bg_color, '#112233');
    document.getElementById('style-racing-font').value = 'System Default';
    document.getElementById('style-racing-font').fire('change');
    assert.equal(CARDS.draft.username_font_family, null, 'the look\'s own font');
    CARDS.openEditor('bits');   // asks first (the stub answers yes)
    CARDS.setTab('customize');
    document.getElementById('style-grows').checked = false;
    document.getElementById('style-grows').fire('change');
    assert.equal(CARDS.draft.style_grows, 0);
    CARDS.closeEditor({ force: true });
  });

  test('"Use <theme> for all six" asks, posts the family, and every card takes the stored rows', async () => {
    const ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner'];
    const racing = ALERT_STYLE_SERVICE.familyStyles('racing');
    const designs = {};
    for (const type of ALERTS) {
      designs[type] = { id: 9, streamer_id: 3, event_type: type, style: racing[type], card_width: 500, style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1 };
    }
    const page = realPage({
      saved: { follow: 'follow-racing' },
      rows: [{ event_type: 'follow', style: 'follow-racing', card_width: 500, animation_speed: 1.5 }],
      answers: [{ status: 200, body: { ok: true, designs } }],
    });
    const { CARDS, g, document, calls, confirms } = page;
    CARDS.openEditor('follow');
    CARDS.setTab('customize');
    CARDS.draft.card_width = 640;   // an edit not saved yet
    assert.equal(CARDS.draft.animation_speed, 1.5);
    const button = document.getElementById('custom-all-six');
    assert.equal(button.textContent, 'Use Racing for all six alerts');
    const result = await CARDS.useFamily();
    assert.equal(result.ok, true);
    assert.deepEqual(confirms, ['Use Racing for all six alerts? Each alert starts this theme\'s look with its own settings.']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/dashboard/overlay-builder/family');
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { family: 'racing' });
    for (const type of ALERTS) {
      assert.equal(g.SAVED_STYLES[type], racing[type], type);
      assert.equal(g.ALERT_STYLES[type], racing[type], type);
      assert.equal(g.SERVER_DESIGNS.find((r) => r.event_type === type).style, racing[type], 'the card reads the stored row: ' + type);
      assert.equal(g.SAVED_DESIGNS[type].style, racing[type]);
    }
    assert.equal(page.renders(), 1, 'the cards are drawn again');
    assert.ok(isOpen(document), 'the window stays open');
    assert.equal(CARDS.draftStyle, 'follow-racing');
    for (const field of ['style_accent', 'style_label', 'style_sound', 'style_grows', 'screen_effect', 'animation_speed']) {
      assert.equal(CARDS.draft[field], designs.follow[field], 'the open alert takes the stored look\'s settings: ' + field);
    }
    assert.equal(CARDS.draft.card_width, 640, 'and keeps what was edited and not saved (lookApplied)');
    assert.ok(!('style' in CARDS.draft) && !('id' in CARDS.draft), 'the draft holds the design only');
    assert.equal(document.getElementById('editor-msg').textContent, 'Racing is now on all six alerts, and saved.');
    assert.equal(CARDS.isDirty(), true, 'the unsaved width is still an edit');
    CARDS.draft.card_width = 500;
    assert.equal(CARDS.isDirty(), false, 'the look is stored: not an edit');
    CARDS.closeEditor({ force: true });
  });

  test('"Use <theme> for all six": a declined question sends nothing; a refusal changes nothing', async () => {
    let page = realPage({ saved: { follow: 'follow-racing' }, confirmAnswer: false });
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('customize');
    assert.equal((await page.CARDS.useFamily()).ok, false);
    assert.equal(page.calls.length, 0);
    page.CARDS.closeEditor({ force: true });

    page = realPage({ saved: { follow: 'follow-racing' }, answers: [{ status: 400, body: { ok: false, error: 'Unknown family' } }] });
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('customize');
    assert.equal((await page.CARDS.useFamily()).ok, false);
    assert.equal(page.document.getElementById('editor-msg').textContent, 'Unknown family');
    assert.equal(page.g.SAVED_STYLES.subscription, undefined);
    assert.equal(page.renders(), 0);
    page.CARDS.closeEditor({ force: true });
  });

  // The window sends one request at a time: a save landing after the family route would keep the draft's settings
  // on the server while the family's answer overwrites the card's row.
  const LOCKED = ['editor-done', 'editor-reset', 'editor-cancel', 'editor-close', 'custom-all-six'];
  test('while "Use <theme> for all six" is on its way, Done and Reset send nothing and the window waits for it', async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const page = realPage({ saved: { follow: 'follow-racing' }, answers: [{ pending }] });
    const { CARDS, document, calls, confirms } = page;
    CARDS.openEditor('follow');
    CARDS.setTab('customize');
    const family = CARDS.useFamily();
    assert.equal(calls.length, 1);
    for (const id of LOCKED) assert.equal(document.getElementById(id).disabled, true, id);
    assert.equal((await CARDS.saveDraft()).ok, false);
    assert.equal((await CARDS.resetDraft()).ok, false);
    document.fire('keydown', { key: 'Escape' });
    document.getElementById('editor-cancel').fire('click');
    document.getElementById('editor-close').fire('click');
    assert.equal(CARDS.closeEditor(), false);
    assert.equal(calls.length, 1, 'no save or reset sent');
    assert.equal(confirms.length, 1, 'only the family\'s question');
    assert.ok(isOpen(document));
    resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, designs: { follow: { event_type: 'follow', style: 'follow-racing' } } }) });
    assert.equal((await family).ok, true);
    for (const id of LOCKED) assert.equal(document.getElementById(id).disabled, false, id);
    CARDS.closeEditor({ force: true });
  });

  test('while Done\'s save or Reset is on its way, "Use <theme> for all six" (and the other) sends nothing', async () => {
    for (const first of ['save', 'reset']) {
      let resolve;
      const pending = new Promise((r) => { resolve = r; });
      const page = realPage({ saved: { follow: 'follow-racing' }, answers: [{ pending }] });
      const { CARDS, document, calls, confirms } = page;
      CARDS.openEditor('follow');
      CARDS.setTab('customize');
      const running = first === 'save' ? CARDS.saveDraft() : CARDS.resetDraft();
      for (const id of LOCKED) assert.equal(document.getElementById(id).disabled, true, `${first}: ${id}`);
      assert.equal((await CARDS.useFamily()).ok, false);
      assert.equal((await (first === 'save' ? CARDS.resetDraft() : CARDS.saveDraft())).ok, false);
      assert.equal(CARDS.closeEditor(), false, first);
      assert.equal(calls.length, 1, `${first}: nothing else sent`);
      assert.equal(confirms.length, first === 'reset' ? 1 : 0, `${first}: no other question`);
      resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      assert.equal((await running).ok, true);
      for (const id of LOCKED) assert.equal(document.getElementById(id).disabled, false, `${first}: ${id} again`);
      CARDS.closeEditor({ force: true });
    }
  });

  // A request with no answer in 20 s ends as one that failed (the dashboard cards' rule).
  test('save, Reset and "Use <theme> for all six" give up after 20 s and free the window', async () => {
    const timeouts = [];
    const signal = { aborted: false };
    const page = realPage({ saved: { follow: 'follow-racing' }, extra: { AbortSignal: { timeout: (ms) => { timeouts.push(ms); return signal; } } } });
    const { CARDS, document, calls } = page;
    CARDS.openEditor('follow');
    CARDS.setTab('customize');
    CARDS.__context.fetch = (url, opts) => {
      calls.push({ url, opts });
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    };
    assert.equal((await CARDS.saveDraft()).ok, false);
    assert.equal((await CARDS.resetDraft()).ok, false);
    assert.equal((await CARDS.useFamily()).ok, false);
    assert.deepEqual(calls.map((c) => c.url), ['/dashboard/overlay-builder/save', '/dashboard/overlay-builder/reset', '/dashboard/overlay-builder/family']);
    assert.ok(calls.every((c) => c.opts.signal === signal), 'each request carries the deadline');
    assert.deepEqual(timeouts, [20000, 20000, 20000]);
    assert.equal(document.getElementById('editor-msg').textContent, 'That did not work. Please try again.');
    for (const id of LOCKED) assert.equal(document.getElementById(id).disabled, false, id);
    assert.ok(isOpen(document));
    CARDS.closeEditor({ force: true });
  });
});

describe('the Sound tab', () => {
  // The real sounds, as the server hands them to the page (routes/dashboard.js builderStyleData), with the keys as names.
  const SOUNDS = ALERT_STYLE_SERVICE.soundGroups().map(({ family, sounds }) => ({
    family,
    sounds: sounds.flatMap((key) => (ALERT_STYLE_SERVICE.secondVersionOf(key) ? [{ key, name: key }, { key: ALERT_STYLE_SERVICE.secondVersionOf(key), name: key + ' (version 2)' }] : [{ key, name: key }])),
  }));
  function soundPage(options = {}) {
    const played = [];
    const kit = { ...KIT, setAudio() {}, playSound: (key) => { played.push(key); return true; } };
    class FakeAudio { constructor() { this.state = 'running'; } resume() {} }
    const data = realStyleData(options.streamer || {});
    data.looks['follow-glass'] = { title: 'Pill' };
    data.sounds = SOUNDS;
    const page = realPage({ ...options, extra: { STYLE_DATA: data, ATLETA_KIT: kit, AudioContext: FakeAudio, ...(options.extra || {}) } });
    return { ...page, played };
  }
  const walk = (node, out = []) => { out.push(node); (node.children || []).forEach((c) => walk(c, out)); return out; };
  const inPane = (document) => walk(document.getElementById('pane-sound'));
  const rowsIn = (node) => walk(node).filter((n) => n.className === 'snd');
  const allRows = (document) => rowsIn(document.getElementById('pane-sound'));
  const groupNamed = (document, name) => inPane(document).find((n) => n.className === 'snd-group' && textOf(n.children[0]).startsWith(name));
  const rowOf = (document, key, group) => rowsIn(group || document.getElementById('pane-sound')).find((r) => r.getAttribute('data-key') === key);
  const pickOf = (row) => row.children.find((c) => c.className === 'snd-pick');
  const playOf = (row) => row.children.find((c) => c.className === 'play');

  test('lists "This look" then only this alert\'s sounds, by theme, each labelled with the alert and its look', () => {
    const page = soundPage();
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    assert.equal(page.document.getElementById('editor-side').hidden, true, 'no stage');
    const rows = allRows(page.document);
    assert.equal(rows.length, 4 + 52);
    const mine = groupNamed(page.document, 'This look');
    assert.deepEqual(rowsIn(mine).map((r) => r.getAttribute('data-key')), ['glFollow', 'glFollow.2', 'today', 'none']);
    const outside = rows.filter((r) => !rowsIn(mine).includes(r));
    assert.equal(outside.length, 52);
    const owners = CORE.soundOwners(KIT.styles);
    for (const r of outside) assert.equal(CORE.ownerOfSound(r.getAttribute('data-key'), owners).eventType, 'follow', r.getAttribute('data-key'));
    const glass = groupNamed(page.document, 'Glass');
    assert.match(textOf(glass.children[0]), /both recordings/);
    const row = rowOf(page.document, 'glFollow', glass);
    const tag = walk(row).find((n) => /^snd-tag/.test(n.className));
    assert.match(textOf(tag), new RegExp(page.CARDS.CARD_ICONS.follow + ' Follow'), 'the alert\'s badge');
    assert.match(textOf(tag), /Pill/, 'the look');
    const name = walk(row).find((n) => n.className === 'snd-name');
    assert.equal(name.getAttribute('title'), 'glFollow', 'the ellipsised name can be read in full');
    const second = walk(rowOf(page.document, 'glFollow.2', glass)).find((n) => n.className === 'snd-name');
    assert.equal(second.getAttribute('title'), 'glFollow (version 2)');
    assert.ok(walk(row).filter((n) => /^snd-(name|tag)/.test(n.className)).every((n) => n.tagName === 'SPAN'), 'phrasing content inside the button');
    const line = walk(tag).find((n) => n.className === 'tag-txt');
    assert.equal(line.getAttribute('title'), 'Pill · Own sound', 'the full text is in the title');
    assert.match(textOf(rowOf(page.document, 'none', mine)), /Silent/);
    assert.match(textOf(rowOf(page.document, 'glFollow', mine)), /Pill . Own sound/);
    assert.match(textOf(rowOf(page.document, 'glFollow.2', mine)), /Version 2/);
    assert.equal(pickOf(rowOf(page.document, 'glFollow', mine)).getAttribute('aria-pressed'), 'true', 'the look\'s own sound is the one in use');
    assert.equal(pickOf(rowOf(page.document, 'none', mine)).getAttribute('aria-pressed'), 'false');
    page.CARDS.closeEditor({ force: true });
  });

  test('picking a row stores its key and plays it, and the look\'s own sound stores null', () => {
    const page = soundPage();
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    const glass = groupNamed(page.document, 'Glass');
    const racing = groupNamed(page.document, 'Racing');
    pickOf(rowOf(page.document, 'rcFlyby', racing)).fire('click');
    assert.equal(page.CARDS.draft.style_sound, 'rcFlyby');
    assert.deepEqual(page.played, ['rcFlyby']);
    assert.equal(page.CARDS.tabValue('sound'), 'rcFlyby');
    assert.equal(page.document.getElementById('editor-tabs').children[2].children[1].textContent, 'rcFlyby', 'the tab bar shows it');
    assert.equal(pickOf(rowOf(page.document, 'rcFlyby', racing)).getAttribute('aria-pressed'), 'true');
    assert.equal(pickOf(rowOf(page.document, 'glFollow', glass)).getAttribute('aria-pressed'), 'false');
    pickOf(rowOf(page.document, 'glFollow.2', glass)).fire('click');
    assert.equal(page.CARDS.draft.style_sound, 'glFollow.2');
    pickOf(rowOf(page.document, 'glFollow', glass)).fire('click');
    assert.equal(page.CARDS.draft.style_sound, null, 'the look\'s own sound is stored as null');
    assert.deepEqual(page.played, ['rcFlyby', 'glFollow.2', 'glFollow']);
    pickOf(rowOf(page.document, 'today', groupNamed(page.document, 'This look'))).fire('click');
    assert.equal(page.CARDS.draft.style_sound, 'today');
    pickOf(rowOf(page.document, 'none', groupNamed(page.document, 'This look'))).fire('click');
    assert.equal(page.CARDS.draft.style_sound, 'none');
    assert.equal(page.played.length, 3, 'the engine sound and silence play nothing here');
    assert.ok(page.CARDS.isDirty());
    page.CARDS.closeEditor({ force: true });
  });

  test('the classic engine sound and "No sound" have nothing to listen to here: their ▶ is off', () => {
    const page = soundPage();
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    const mine = groupNamed(page.document, 'This look');
    const today = playOf(rowOf(page.document, 'today', mine));
    assert.equal(today.disabled, true);
    assert.equal(today.getAttribute('title'), 'Today\'s sound plays in OBS: use Test to hear it.');
    const none = playOf(rowOf(page.document, 'none', mine));
    assert.equal(none.disabled, true);
    assert.equal(none.getAttribute('title'), null);
    assert.equal(playOf(rowOf(page.document, 'glFollow', mine)).disabled, false);
    page.CARDS.closeEditor({ force: true });
  });

  test('the play button listens without picking', () => {
    const page = soundPage();
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    const row = rowOf(page.document, 'rcFlyby', groupNamed(page.document, 'Racing'));
    assert.equal(playOf(row).getAttribute('aria-label'), 'Listen');
    playOf(row).fire('click');
    assert.deepEqual(page.played, ['rcFlyby']);
    assert.equal(page.CARDS.draft.style_sound ?? null, null, 'nothing was picked');
    page.CARDS.closeEditor({ force: true });
  });

  test('a saved sound from another alert shows as "Current" and a save sends it unchanged', async () => {
    const page = soundPage({ saved: { bits: 'bits-glass' }, rows: [{ event_type: 'bits', style: 'bits-glass', style_sound: 'glFollow' }] });
    page.CARDS.openEditor('bits');
    page.CARDS.setTab('sound');
    const mine = groupNamed(page.document, 'This look');
    const first = rowsIn(mine)[0];
    assert.equal(first.getAttribute('data-key'), 'glFollow');
    assert.match(textOf(first), /Current/);
    assert.match(textOf(first), new RegExp(page.CARDS.CARD_ICONS.follow + ' Follow'), 'labelled with the alert it was made for');
    assert.equal(pickOf(first).getAttribute('aria-pressed'), 'true');
    assert.equal(allRows(page.document).filter((r) => r.getAttribute('data-key') === 'glFollow').length, 1, 'bits do not list follow\'s sounds otherwise');
    await page.CARDS.saveDraft();
    assert.equal(JSON.parse(page.calls[0].opts.body).design.style_sound, 'glFollow');
  });

  test('an uploaded sound for the alert shows the notice with a link to the overlay settings', () => {
    const page = soundPage({ extra: { BUILDER: { features: {}, uploadedSounds: { follow: true, bits: false } } } });
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    const notice = inPane(page.document).find((n) => n.className === 'snd-notice');
    assert.ok(notice);
    assert.match(textOf(notice), /You uploaded a sound for this alert/);
    const link = walk(notice).find((n) => n.tagName === 'A');
    assert.equal(link.getAttribute('href'), '/dashboard/overlay');
    assert.equal(link.textContent, 'Overlay settings');
    page.CARDS.closeEditor({ force: true });
    page.CARDS.openEditor('bits');
    page.CARDS.setTab('sound');
    assert.ok(!inPane(page.document).some((n) => n.className === 'snd-notice'), 'no notice without an upload');
    page.CARDS.closeEditor({ force: true });
  });

  test('the search box filters rows by name, and a theme chip shows only that theme (and "This look")', () => {
    const page = soundPage();
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    const input = inPane(page.document).find((n) => n.tagName === 'INPUT');
    assert.equal(input.getAttribute('placeholder'), 'Search sounds…');
    input.value = 'RCFLYBY';
    input.fire('input');
    assert.deepEqual(allRows(page.document).map((r) => r.getAttribute('data-key')), ['rcFlyby', 'rcFlyby.2']);
    assert.ok(!groupNamed(page.document, 'This look'), 'a group with no match is gone');
    input.value = '';
    input.fire('input');
    assert.equal(allRows(page.document).length, 56);

    const chips = inPane(page.document).filter((n) => n.className === 'anim-chip');
    assert.equal(chips[0].textContent, 'All');
    assert.equal(chips.length, 27, 'all, and the 26 themes that have a follow sound');
    chips.find((c) => c.getAttribute('data-family') === 'racing').fire('click');
    assert.equal(allRows(page.document).length, 4 + 2);
    assert.ok(groupNamed(page.document, 'Racing'));
    assert.ok(!groupNamed(page.document, 'Glass'));
    assert.equal(inPane(page.document).filter((n) => n.className === 'anim-chip').find((c) => c.getAttribute('data-family') === 'racing').getAttribute('aria-pressed'), 'true');
    page.CARDS.closeEditor({ force: true });
    page.CARDS.openEditor('follow');
    page.CARDS.setTab('sound');
    assert.equal(allRows(page.document).length, 56, 'a new window shows every theme again');
    page.CARDS.closeEditor({ force: true });
  });
});

describe('the Location tab', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  // The stage as the page has it: a 960 px wide column (half the 1920 canvas), the slot as OBS lays it out
  // (420 x 120), the particles and sounds recorded.
  function locPage(options = {}) {
    const played = [], spawned = [], oldEffects = [];
    const kit = {
      lookData: (look, sample) => sample, slotVars: () => ({}), soundFor: (look) => look.sound,
      effectFor: () => options.effect || 'smoke', setAudio() {}, playSound: (key) => { played.push(key); return true; },
    };
    class FakeAudio { constructor() { this.state = 'running'; } resume() {} }
    const page = loadPage({
      ...options,
      extra: {
        ATLETA_KIT: kit, AudioContext: FakeAudio,
        ATLETA_FX: { KINDS: ['smoke'], spawn: (layer, kind, opts) => { spawned.push([kind, opts.scale]); return []; } },
        renderScreenEffect: (effect, target) => oldEffects.push([effect, target]),
        ...(options.extra || {}),
      },
    });
    const stage = page.document.getElementById('stage'), slot = page.document.getElementById('stage-slot');
    stage.clientWidth = 960;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0 });
    slot.offsetWidth = 420;
    slot.offsetHeight = 120;
    slot.captured = [];
    slot.setPointerCapture = (id) => slot.captured.push(id);
    return { ...page, played, spawned, oldEffects, stage, slot };
  }
  const walk = (node, out = []) => { out.push(node); (node.children || []).forEach((c) => walk(c, out)); return out; };
  const inPane = (document) => walk(document.getElementById('pane-location'));
  const cellOf = (document, pos) => inPane(document).find((n) => n.getAttribute('data-pos') === pos);
  const modeOf = (document, mode) => inPane(document).find((n) => n.getAttribute('data-mode') === mode);
  const openLocation = (page) => { page.CARDS.openEditor('follow'); page.CARDS.setTab('location'); };
  const FREE = { event_type: 'follow', card_position: 'top-center', card_custom_x: 0.2, card_custom_y: 0.3 };

  test('a fixed spot clears the free position', () => {
    const page = locPage({ rows: [FREE] });
    openLocation(page);
    assert.equal(modeOf(page.document, 'free').getAttribute('aria-pressed'), 'true');
    cellOf(page.document, 'bot-right').fire('click');
    assert.equal(page.CARDS.draft.card_position, 'bot-right');
    assert.equal(page.CARDS.draft.card_custom_x, null);
    assert.equal(page.CARDS.draft.card_custom_y, null);
    assert.equal(modeOf(page.document, 'fixed').getAttribute('aria-pressed'), 'true');
    assert.equal(cellOf(page.document, 'bot-right').getAttribute('aria-pressed'), 'true');
    assert.equal(cellOf(page.document, 'top-center').getAttribute('aria-pressed'), 'false');
    assert.equal(page.CARDS.tabValue('location'), 'Bottom right', 'the tab bar says where it sits');
    assert.equal(page.slot.style.right, '16px', 'the stage slot moved there');
    assert.equal(page.slot.style.bottom, '16px');
    page.CARDS.closeEditor({ force: true });
  });

  test('switching to free position starts where the alert sits now', () => {
    const page = locPage({ rows: [{ event_type: 'follow', card_position: 'bot-right', card_width: 420 }] });
    openLocation(page);
    assert.equal(modeOf(page.document, 'fixed').getAttribute('aria-pressed'), 'true');
    modeOf(page.document, 'free').fire('click');
    // 1920 - 16 - 420 from the left, 1080 - 16 - 120 from the top, as fractions of the screen
    assert.equal(page.CARDS.draft.card_custom_x, CORE.clampFree(1920 - 16 - 420, 1080 - 16 - 120, 420, 120).x);
    assert.equal(page.CARDS.draft.card_custom_x, 0.773);
    assert.equal(page.CARDS.draft.card_custom_y, 0.874);
    assert.equal(page.CARDS.draft.card_position, 'bot-right', 'the fixed spot is kept for the way back');
    assert.equal(modeOf(page.document, 'free').getAttribute('aria-pressed'), 'true');
    assert.equal(page.CARDS.tabValue('location'), 'Free position');
    assert.ok(page.stage.classList.contains('dragging-on'), 'the alert takes the pointer');
    modeOf(page.document, 'fixed').fire('click');
    assert.equal(page.CARDS.draft.card_custom_x, null);
    assert.ok(!page.stage.classList.contains('dragging-on'));
    page.CARDS.closeEditor({ force: true });
  });

  test('dragging keeps the alert on the screen and stores fractions', () => {
    const page = locPage({ rows: [{ event_type: 'follow', card_position: 'top-center', card_custom_x: 0, card_custom_y: 0 }] });
    openLocation(page);
    page.slot.fire('pointerdown', { clientX: 0, clientY: 0, pointerId: 7, button: 0 });
    assert.deepEqual(page.slot.captured, [7], 'the pointer is captured');
    page.slot.fire('pointermove', { clientX: -50, clientY: 1000 });   // (-100, 2000) on the 1920 x 1080 stage
    assert.equal(page.CARDS.draft.card_custom_x, 0);
    assert.equal(page.CARDS.draft.card_custom_y, Math.round(960 / 1080 * 1000) / 1000);
    page.slot.fire('pointermove', { clientX: 400, clientY: 100 });    // (800, 200)
    assert.equal(page.CARDS.draft.card_custom_x, Math.round(800 / 1920 * 1000) / 1000);
    assert.equal(page.CARDS.draft.card_custom_y, Math.round(200 / 1080 * 1000) / 1000);
    page.slot.fire('pointerup', {});
    const before = page.CARDS.draft.card_custom_x;
    page.slot.fire('pointermove', { clientX: 10, clientY: 10 });
    assert.equal(page.CARDS.draft.card_custom_x, before, 'nothing moves after the pointer is released');
    assert.ok(page.CARDS.isDirty());
    page.CARDS.closeEditor({ force: true });
  });

  test('the pointer grabs the alert where it was touched, and a fixed spot cannot be dragged', () => {
    const page = locPage({ rows: [{ event_type: 'follow', card_position: 'top-center', card_custom_x: 0.5, card_custom_y: 0.5 }] });
    openLocation(page);
    // the alert's corner is (960, 540); touching 30 px right of and 20 px below it keeps that offset
    page.slot.fire('pointerdown', { clientX: (960 + 30) / 2, clientY: (540 + 20) / 2, pointerId: 1, button: 0 });
    page.slot.fire('pointermove', { clientX: (200 + 30) / 2, clientY: (100 + 20) / 2 });
    assert.equal(page.CARDS.draft.card_custom_x, Math.round(200 / 1920 * 1000) / 1000);
    assert.equal(page.CARDS.draft.card_custom_y, Math.round(100 / 1080 * 1000) / 1000);
    page.slot.fire('pointerup', {});
    modeOf(page.document, 'fixed').fire('click');
    page.slot.fire('pointerdown', { clientX: 0, clientY: 0, pointerId: 2, button: 0 });
    page.slot.fire('pointermove', { clientX: 300, clientY: 300 });
    assert.equal(page.CARDS.draft.card_custom_x, null, 'no drag in fixed mode');
    page.CARDS.closeEditor({ force: true });
  });

  test('the size slider spans the placement bounds and sets the width', () => {
    const page = locPage();
    openLocation(page);
    const slider = inPane(page.document).find((n) => n.id === 'loc-width');
    assert.equal(slider.type, 'range');
    assert.equal(slider.getAttribute('min'), '200');
    assert.equal(slider.getAttribute('max'), '900');
    assert.equal(slider.getAttribute('step'), '10');
    assert.equal(Number(slider.value), 420);
    slider.value = '640';
    slider.fire('input');
    assert.equal(page.CARDS.draft.card_width, 640);
    assert.equal(page.slot.style.width, '640px', 'the stage slot follows');
    assert.equal(page.slot.style.getPropertyValue('--zw'), String(640 / 420));
    assert.ok(inPane(page.document).some((n) => n.textContent === '640 px wide'));
    page.CARDS.closeEditor({ force: true });
  });

  test('the stage slot carries the placement, the screen width for cars and the look class', () => {
    const page = locPage();
    openLocation(page);
    assert.equal(page.slot.style.left, '50%');
    assert.equal(page.slot.style.top, '16px');
    assert.equal(page.slot.style.width, '420px');
    assert.equal(page.slot.style.getPropertyValue('--fw'), '1920px');
    assert.ok(page.slot.classList.contains('look'), 'a look is drawn for 420 px and scaled');
    page.CARDS.closeEditor({ force: true });
  });

  test('the alert loops on the stage with its effect while the tab is open, and everything stops when the tab or window closes', () => {
    const page = locPage();
    openLocation(page);
    assert.ok(page.slot.classList.contains('playing'), 'plays at once');
    assert.deepEqual(page.spawned, [['smoke', 1]], 'the look\'s effect, drawn on the 1920 stage');
    advance(1000 + 2400 + 500 + 50 + 800 + 10);   // the entrance, the hold, the exit, the pause
    assert.equal(page.spawned.length, 2, 'it plays again');
    page.CARDS.setTab('sound');
    assert.ok(!page.slot.classList.contains('playing'), 'the slot is emptied when the tab changes');
    advance(20000);
    assert.equal(page.spawned.length, 2, 'no timer is left');
    page.CARDS.setTab('location');
    assert.equal(page.spawned.length, 3);
    assert.ok(page.slot.classList.contains('playing'));
    page.CARDS.closeEditor({ force: true });
    assert.ok(!page.slot.classList.contains('playing'), 'and when the window closes');
    advance(20000);
    assert.equal(page.spawned.length, 3);
  });

  test('an older effect goes through the page\'s own screen effect, on the stage, with the draft', () => {
    const page = locPage({ effect: 'confetti' });
    openLocation(page);
    assert.deepEqual(page.spawned, []);
    assert.equal(page.oldEffects.length, 1);
    assert.equal(page.oldEffects[0][0], 'confetti');
    assert.equal(page.oldEffects[0][1].screen, page.stage);
    assert.equal(page.oldEffects[0][1].design, page.CARDS.draft);
    assert.equal(page.oldEffects[0][1].type, 'follow');
    page.CARDS.closeEditor({ force: true });
  });

  test('Replay plays the sound once; "Sound on every loop" plays it every time', () => {
    const page = locPage();
    openLocation(page);
    assert.deepEqual(page.played, [], 'a loop is silent by default');
    page.document.getElementById('stage-replay').fire('click');
    assert.deepEqual(page.played, ['glFollow']);
    advance(5000);
    assert.deepEqual(page.played, ['glFollow'], 'the next loops stay silent');
    page.document.getElementById('stage-sound-loop').checked = true;
    advance(10000);
    assert.ok(page.played.length >= 3, 'every loop plays it');
    assert.ok(page.played.every((key) => key === 'glFollow'));
    page.CARDS.closeEditor({ force: true });
  });

  test('Replay while the stage is not playing leaves no sound waiting for the next loop', () => {
    const page = locPage();
    openLocation(page);
    page.CARDS.setTab('sound');
    page.document.getElementById('stage-replay').fire('click');
    page.CARDS.setTab('location');
    assert.deepEqual(page.played, [], 'the stage starts silent again');
    page.document.getElementById('stage-replay').fire('click');
    assert.deepEqual(page.played, ['glFollow']);
    page.CARDS.closeEditor({ force: true });
  });

  test('only the main button of the primary pointer drags the alert', () => {
    const page = locPage({ rows: [{ event_type: 'follow', card_position: 'top-center', card_custom_x: 0.5, card_custom_y: 0.5 }] });
    openLocation(page);
    page.slot.fire('pointerdown', { clientX: 480, clientY: 270, pointerId: 1, button: 2, isPrimary: true });
    page.slot.fire('pointermove', { clientX: 100, clientY: 100 });
    assert.equal(page.CARDS.draft.card_custom_x, 0.5, 'not with the secondary button');
    page.slot.fire('pointerdown', { clientX: 480, clientY: 270, pointerId: 2, button: 0, isPrimary: false });
    page.slot.fire('pointermove', { clientX: 100, clientY: 100 });
    assert.equal(page.CARDS.draft.card_custom_x, 0.5, 'not with a second finger');
    assert.deepEqual(page.slot.captured, []);
    page.slot.fire('pointerdown', { clientX: 480, clientY: 270, pointerId: 3, button: 0, isPrimary: true });
    page.slot.fire('pointermove', { clientX: 100, clientY: 100 });
    assert.notEqual(page.CARDS.draft.card_custom_x, 0.5, 'the main button drags');
    page.CARDS.closeEditor({ force: true });
  });

  test('a sound the streamer uploaded for the alert is not replaced by the look\'s on the stage', () => {
    const page = locPage();
    page.g.BUILDER.uploadedSounds = { follow: true };
    openLocation(page);
    page.document.getElementById('stage-replay').fire('click');
    assert.deepEqual(page.played, []);
    page.CARDS.closeEditor({ force: true });
  });
});

// ── The legacy cards ──
// The sponsor images and the YouTube alerts keep today's card editor, which the page owns: its controls
// (getControlValues / setControlValues), its pop-ups and the card updatePreview() draws. The fakes record what
// the window asks of the page; `controls` is what the page's controls hold.
describe('the legacy cards: the sponsor images and the YouTube alerts keep today\'s card editor', () => {
  const VIEW = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'overlay-builder.ejs'), 'utf8');
  const between = (from, to) => {
    const start = VIEW.indexOf(from);
    assert.ok(start > 0, from);
    const end = VIEW.indexOf(to, start + 1);
    assert.ok(end > start, to);
    return VIEW.slice(start, end);
  };
  const PLACE = ['card_width', 'card_position', 'card_custom_x', 'card_custom_y'];

  function legacyPage(options = {}) {
    const log = [];
    const controls = { bg_color: '#1a1a3e', card_width: 420, card_position: 'top-center', card_custom_x: null, card_custom_y: null, sponsor_animation: 'fade', ...(options.controls || {}) };
    const workingDesigns = { timed: { label_color: '#ff0000' }, yt_member: {} };
    let context = null;
    const page = loadPage({
      ...options,
      extra: {
        workingDesigns, sponsorRotationEnabled: true,
        getControlValues: () => ({ ...controls }),
        setControlValues: (d) => {
          log.push(['setControlValues', context.currentType, { ...d }]);
          for (const k of Object.keys(controls)) if (k in d) controls[k] = d[k];
        },
        setCardPlace: (p) => { log.push(['setCardPlace', { ...p }]); PLACE.forEach((k) => { controls[k] = p[k]; }); },
        updatePreview: () => log.push('updatePreview'),
        updateSponsorPreview: () => log.push('updateSponsorPreview'),
        stopSponsorPreview: () => log.push('stopSponsorPreview'),
        renderSponsorList: () => log.push('renderSponsorList'),
        playPreviewAnimation: () => log.push('playPreviewAnimation'),
        ...(options.extra || {}),
      },
    });
    context = page.CARDS.__context;
    const stage = page.document.getElementById('stage');
    stage.clientWidth = 960;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const slot = page.document.getElementById('stage-slot');
    slot.offsetWidth = 500;
    slot.offsetHeight = 140;
    return { ...page, log, controls, workingDesigns, stage, slot, card: page.document.getElementById('preview-card-container'), home: page.document.getElementById('legacy-preview') };
  }
  const SPONSOR_ROW = { event_type: 'timed', card_width: 500, card_position: 'bot-center', sponsor_animation: 'zoom' };
  const tabsOf = (document) => document.getElementById('editor-tabs').children.map((b) => b.getAttribute('data-tab'));
  const walk = (node, out = []) => { out.push(node); (node.children || []).forEach((c) => walk(c, out)); return out; };

  test('the sponsor images window has Images, Design and Location, and Images holds today\'s sponsor controls', () => {
    const images = between('id="pane-images"', 'id="pane-design"');
    for (const id of ['sp-rotation-toggle', 'sponsor-list', 'sp-upload-zone', 'sp-file-input', 'sp-upload-name', 'sp-upload-dur', 'sp-upload-btn']) {
      assert.ok(images.includes(`id="${id}"`), id);
    }
    assert.ok(!images.includes('id="ctrl-sponsor-animation"'), 'the image animation is a design property, saved by Done');
    const design = between('id="pane-design"', 'id="editor-side"');
    // The image animation opens the Design tab (the sponsor images' only; the YouTube alerts' Design tab hides it).
    assert.ok(design.indexOf('id="ctrl-sponsor-animation"') > 0 && design.indexOf('id="ctrl-sponsor-animation"') < design.indexOf('id="section-theme"'), 'at the top of Design');
    assert.match(design, /<select id="ctrl-sponsor-animation"[^>]*onchange="updatePreview\(\); replaySponsorAnimation\(\);"/, 'it still previews as it changes');
    for (const value of ['fade', 'slide-left', 'slide-right', 'slide-up', 'drop-down', 'zoom', 'none']) assert.ok(design.includes(`<option value="${value}">`), value);
    assert.match(VIEW, /\.ed:not\(\[data-card="timed"\]\) \.sp-anim-row \{ display: none; \}/, 'only the sponsor images show it');
    for (const id of ['section-theme', 'section-text', 'section-sideicon', 'section-animation', 'row-border-radius', 'ctrl-border-radius',
      'ctrl-bg-color', 'ctrl-event-label', 'ctrl-detail-text', 'side-icon-grid', 'ctrl-entrance-animation', 'ctrl-screen-effect']) {
      assert.ok(design.includes(`id="${id}"`), id);
    }
    assert.ok(!VIEW.includes('class="builder-layout"'), 'today\'s hidden editor is gone');
    assert.ok(!VIEW.includes('id="preview-screen"'), 'and its preview frame');
    assert.ok(!VIEW.includes('resize-handle'), 'and its resize handles');

    const page = legacyPage();
    page.CARDS.openEditor('timed');
    assert.deepEqual(tabsOf(page.document), ['images', 'design', 'location']);
    assert.equal(page.CARDS.tab, 'images');
    assert.ok(page.log.includes('renderSponsorList'), 'the list is drawn');
    assert.equal(page.document.getElementById('sp-rotation-toggle').checked, true, 'the rotation switch says whether the rotation is on');
    assert.equal(page.document.getElementById('editor-side').hidden, true, 'no stage on Images');
    page.CARDS.closeEditor({ force: true });
  });

  test('the stage of a legacy card has a plain Replay, without "Sound on every loop" and the loop hint', () => {
    assert.match(VIEW, /\.ed\.legacy \.stage-loop, \.ed\.legacy \.stage-hint \{ display: none; \}/);
    assert.match(VIEW, /<label class="cz-check stage-loop"><input type="checkbox" id="stage-sound-loop">/);
    const page = legacyPage();
    const editor = page.document.getElementById('editor'), replay = page.document.getElementById('stage-replay');
    for (const type of ['timed', 'yt_member']) {
      page.CARDS.openEditor(type);
      assert.ok(editor.classList.contains('legacy'), type);
      assert.equal(editor.getAttribute('data-card'), type);
      assert.equal(replay.textContent, '↻ Replay', type);
      page.CARDS.closeEditor({ force: true });
    }
    page.CARDS.openEditor('follow');
    assert.ok(!editor.classList.contains('legacy'), 'an alert with a look plays its sound');
    assert.equal(editor.getAttribute('data-card'), 'follow');
    assert.equal(replay.textContent, '↻ Replay with sound');
    page.CARDS.closeEditor({ force: true });
  });

  test('YouTube cards are drawn only while YouTube is on, with Design and Location', () => {
    assert.match(VIEW, /<% if \(features\.youtube\) \{ %>\s*<h2[^\n]*\n\s*<div class="cards" id="cards-youtube"><\/div>\s*<% \} %>/);
    const { shownCards } = load();
    assert.ok(!shownCards({ youtube: false }).some((t) => /^yt_/.test(t)));
    assert.deepEqual(shownCards({ youtube: true }).filter((t) => /^yt_/.test(t)), ['yt_superchat', 'yt_member', 'yt_giftmember']);

    const page = legacyPage({ features: { youtube: true } });
    assert.equal(page.CARDS.openFromUrl('?tab=yt_member'), 'yt_member');
    assert.deepEqual(tabsOf(page.document), ['design', 'location']);
    assert.equal(page.CARDS.tab, 'design');
    assert.equal(page.CARDS.draftStyle, null, 'no look');
    assert.equal(page.document.getElementById('editor-side').hidden, false, 'the stage beside Design');
    assert.ok(page.slot.children.includes(page.card), 'the page\'s card is in the stage');
    assert.ok(page.log.includes('updatePreview'), 'drawn by the page');
    page.CARDS.closeEditor({ force: true });
  });

  test('opening a legacy card loads its design into the page\'s controls, as it is stored', () => {
    const page = legacyPage({ rows: [SPONSOR_ROW] });
    page.CARDS.openEditor('timed');
    const set = page.log.find((entry) => entry[0] === 'setControlValues');
    assert.ok(set, 'setControlValues was called');
    assert.equal(set[1], 'timed', 'with currentType already the card\'s');
    assert.deepEqual(set[2], { card_width: 500, card_position: 'bot-center', sponsor_animation: 'zoom' }, 'the stored row over the defaults');
    assert.deepEqual({ ...page.workingDesigns.timed }, set[2], 'the page\'s working copy starts again from it (no edit left from a cancelled window)');
    assert.deepEqual({ ...page.CARDS.draft }, page.controls, 'the window\'s draft is what the controls hold');
    assert.equal(page.CARDS.isDirty(), false);
    page.CARDS.closeEditor({ force: true });
  });

  test('Done on a legacy card saves getControlValues() for that type with no style', async () => {
    const page = legacyPage({ rows: [SPONSOR_ROW] });
    page.CARDS.openEditor('timed');
    page.controls.bg_color = '#223344';   // an edit made with the page's controls (the Design tab)
    assert.equal(page.CARDS.isDirty(), true, 'an edit in the page\'s controls is an edit');
    await page.CARDS.saveDraft();
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].url, '/dashboard/overlay-builder/save');
    assert.equal(page.calls[0].opts.body, JSON.stringify(CORE.savePayload('timed', page.CARDS.__context.getControlValues())));
    const body = JSON.parse(page.calls[0].opts.body);
    assert.ok(!('style' in body), 'no look for the sponsor images');
    assert.equal(body.design.bg_color, '#223344');
    const row = page.g.SERVER_DESIGNS.find((r) => r.event_type === 'timed');
    assert.equal(row.bg_color, '#223344', 'the stored row is what was saved');
    assert.ok(!('style' in row));
    assert.ok(!isOpen(page.document));
  });

  test('the Design and Location tabs show the page\'s card in the stage at its place, and give it back when they close', () => {
    const page = legacyPage({ rows: [SPONSOR_ROW] });
    page.CARDS.openEditor('timed');
    assert.ok(!page.slot.children.includes(page.card), 'not on Images');
    page.CARDS.setTab('design');
    assert.ok(page.slot.children.includes(page.card), 'the card is the stage\'s slot');
    assert.deepEqual(page.log.slice(-2), ['updatePreview', 'updateSponsorPreview'], 'drawn by the page, with its sponsor image');
    assert.equal(page.slot.style.bottom, '16px', 'at its place');
    assert.equal(page.slot.style.width, '500px');
    assert.ok(!page.slot.classList.contains('look'), 'reflowed, not a look scaled from 420 px');
    assert.ok(!page.slot.classList.contains('playing'), 'nothing loops it');
    page.document.getElementById('stage-replay').fire('click');
    assert.equal(page.log[page.log.length - 1], 'playPreviewAnimation', 'Replay plays its entrance');
    page.CARDS.setTab('location');
    assert.ok(page.slot.children.includes(page.card), 'still there on Location');
    page.CARDS.setTab('images');
    assert.ok(page.home.children.includes(page.card), 'given back off the stage');
    assert.ok(page.log.includes('stopSponsorPreview'), 'its image rotation stops');
    page.CARDS.setTab('design');
    const givenBack = page.home.children.length;
    page.CARDS.closeEditor({ force: true });
    assert.equal(page.home.children.length, givenBack + 1, 'given back when the window closes too');
    assert.equal(page.home.children[givenBack], page.card);
  });

  test('the Location tab hands a legacy card\'s place to the page\'s controls, which the save reads', async () => {
    const page = legacyPage({ rows: [SPONSOR_ROW] });
    page.CARDS.openEditor('timed');
    page.CARDS.setTab('location');
    const pane = walk(page.document.getElementById('pane-location'));
    pane.find((n) => n.getAttribute('data-pos') === 'top-left').fire('click');
    assert.deepEqual(page.log.filter((e) => e[0] === 'setCardPlace').pop()[1], { card_position: 'top-left', card_width: 500, card_custom_x: null, card_custom_y: null });
    const slider = pane.find((n) => n.id === 'loc-width');
    slider.value = '640';
    slider.fire('input');
    assert.equal(page.controls.card_width, 640);
    pane.find((n) => n.getAttribute('data-mode') === 'free').fire('click');
    page.slot.fire('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    page.slot.fire('pointermove', { clientX: 100, clientY: 50 });
    page.slot.fire('pointerup', {});
    assert.equal(page.controls.card_custom_x, page.CARDS.draft.card_custom_x, 'a drag too');
    assert.ok(page.controls.card_custom_x > 0);
    assert.equal(page.CARDS.isDirty(), true);
    await page.CARDS.saveDraft();
    const body = JSON.parse(page.calls[0].opts.body);
    assert.deepEqual([body.design.card_position, body.design.card_width, body.design.card_custom_x], ['top-left', 640, page.controls.card_custom_x]);
  });

  test('Reset of a legacy card loads its defaults into the page\'s controls', async () => {
    const page = legacyPage({ rows: [SPONSOR_ROW] });
    page.CARDS.openEditor('timed');
    page.CARDS.setTab('design');
    page.controls.bg_color = '#223344';
    const result = await page.CARDS.resetDraft();
    assert.equal(result.ok, true);
    const set = page.log.filter((entry) => entry[0] === 'setControlValues').pop();
    assert.deepEqual(set[2], { card_width: 500, card_position: 'bot-center', sponsor_animation: 'fade' }, 'the defaults');
    assert.equal(page.CARDS.isDirty(), false);
    assert.equal(page.log[page.log.length - 1], 'updateSponsorPreview', 'the Design tab draws the card again');
    page.CARDS.closeEditor({ force: true });
  });

  test('closing the sponsor images window draws the cards again (its images and rotation may have changed)', () => {
    const page = legacyPage();
    page.CARDS.openEditor('timed');
    page.CARDS.closeEditor();
    assert.equal(page.renders(), 1);
    page.CARDS.openEditor('follow');
    page.CARDS.closeEditor();
    assert.equal(page.renders(), 1, 'an alert\'s Cancel draws nothing');
  });

  test('Esc with one of the page\'s pop-ups open closes only the pop-up', () => {
    const page = legacyPage();
    page.CARDS.openEditor('timed');
    page.CARDS.setTab('design');
    const popup = fakeElement(page.document, 'div');
    popup.classList.add('modal-overlay', 'visible');
    let prevented = false;
    page.document.querySelector = (selector) => (selector === '.modal-overlay.visible' && popup.classList.contains('visible') ? popup : null);
    page.document.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.ok(!popup.classList.contains('visible'), 'the pop-up closed');
    assert.ok(prevented);
    assert.ok(isOpen(page.document), 'the window stays');
    assert.equal(page.CARDS.editing, 'timed');
    page.document.fire('keydown', { key: 'Escape' });
    assert.ok(!isOpen(page.document), 'the next Esc closes the window');
  });
});
