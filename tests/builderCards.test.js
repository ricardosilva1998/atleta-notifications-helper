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

// The page script in a context of its own; `globals` are what the view's inline script defines.
function load(globals = {}) {
  const context = vm.createContext({
    // Resolved at call time, so mock.timers' replacements are used.
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    ATLETA_BUILDER_STYLES: CORE,
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
  'editor-msg', 'editor-reset', 'editor-cancel', 'editor-done', 'stage', 'stage-inner', 'stage-bg',
  'pane-animation', 'pane-customize', 'pane-sound', 'pane-location', 'pane-images', 'pane-design',
  // the Animation and Customize tabs
  'anim-chips', 'anim-gallery', 'custom-preview', 'custom-slot', 'custom-nothing', 'custom-row-accent', 'custom-row-racing',
  'custom-row-label', 'custom-row-speed', 'custom-row-effect', 'custom-row-grows', 'style-accent', 'style-accent-own', 'style-accent-val',
  'style-racing-card', 'style-racing-accent', 'style-racing-name', 'style-racing-font', 'style-label', 'style-speed', 'val-style-speed',
  'style-effect', 'style-grows', 'custom-all-six'];

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
