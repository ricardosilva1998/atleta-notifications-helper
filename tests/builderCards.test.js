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
  'pane-animation', 'pane-customize', 'pane-sound', 'pane-location', 'pane-images', 'pane-design'];

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
    let observed;
    class FakeObserver {
      constructor(callback, options) { observed = { callback, options, targets: [] }; }
      observe(el) { observed.targets.push(el); }
      unobserve() {}
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
