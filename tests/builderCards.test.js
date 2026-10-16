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
  return context.ATLETA_BUILDER_CARDS;
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
