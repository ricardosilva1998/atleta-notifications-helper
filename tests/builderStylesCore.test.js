'use strict';

// public/js/builder-styles-core.js: the Overlay Builder's Style section, the parts that need no page.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../public/js/builder-styles-core.js');
const K = require('../public/overlay/objects/kit.js');
require('../public/overlay/objects/styles/samurai.js');
require('../public/overlay/objects/styles/racing.js');
const { DEFAULT_STYLES } = require('../src/services/alertStyles');

describe('the six alerts that have looks', () => {
  test('are the Twitch five and the giveaway; YouTube\'s and timed messages keep today\'s card', () => {
    assert.deepEqual(core.STYLED_ALERTS, ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner']);
    assert.deepEqual(core.STYLED_ALERTS, K.ALERTS, 'the kit\'s six');
    assert.equal(core.isStyled('yt_member'), false);
  });
});

describe('picking another look', () => {
  const design = { style_accent: '#29E0FF', style_label: 'Hi', style_sound: 'rcFlyby', style_grows: 0, screen_effect: 'gold', animation_speed: 1.5, card_width: 560, card_position: 'bot-left', bg_color: '#123456' };

  test('starts the look from its own settings, as the server does; where it sits and its colours stay', () => {
    assert.deepEqual(core.withLook(design, 'follow-samurai', 'follow-racing'), {
      ...design, style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1,
    });
  });

  test('the same look again changes nothing, and the design given is never changed', () => {
    assert.deepEqual(core.withLook(design, 'follow-racing', 'follow-racing'), design);
    assert.deepEqual(core.withLook(design, null, null), design);
    const copy = { ...design };
    core.withLook(design, 'a', 'b');
    assert.deepEqual(design, copy);
  });
});

describe('"Use <family> for all six alerts"', () => {
  const LOOK_RESET = { style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1 };

  test('an alert takes the stored look and its settings, and keeps what the streamer edited and has not saved', () => {
    const working = { card_position: 'bot-right', card_width: 600, accent_color: '#123456', style: 'follow-samurai', style_accent: '#29E0FF', style_label: 'Hi', screen_effect: 'confetti', animation_speed: 1.5 };
    const row = Object.assign({ card_position: 'top-left', card_width: 420, accent_color: '#E8202A', style: 'follow-racing' }, LOOK_RESET);
    const out = core.lookApplied(working, row);
    assert.deepEqual(out, Object.assign({ card_position: 'bot-right', card_width: 600, accent_color: '#123456', style: 'follow-racing' }, LOOK_RESET));
    assert.equal(working.style, 'follow-samurai', 'the working design is not changed in place');
  });

  test('an alert whose tab was never opened is the stored row', () => {
    const row = Object.assign({ card_position: 'top-left', style: 'raid-racing' }, LOOK_RESET);
    assert.deepEqual(core.lookApplied(undefined, row), row);
  });
});

describe('the look the page shows', () => {
  test('the one picked or saved, else the alert\'s default look; nothing for the other tabs', () => {
    assert.equal(core.shownStyle('follow', { follow: 'follow-racing' }, DEFAULT_STYLES), 'follow-racing');
    assert.equal(core.shownStyle('follow', {}, DEFAULT_STYLES), 'follow-glass');
    assert.equal(core.shownStyle('giveaway_winner', {}, DEFAULT_STYLES), 'giveaway-glass');
    assert.equal(core.shownStyle('yt_member', {}, DEFAULT_STYLES), null);
  });

  test('an alert nobody has given a look shows its default look\'s own settings, not what an older builder saved for the card', () => {
    const old = { screen_effect: 'confetti', animation_speed: 1.8, card_width: 600 };
    const own = { ...old, style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1 };
    assert.deepEqual(core.untouched('follow', old, null), own);
    assert.deepEqual(core.untouched('giveaway_winner', old, null), own, 'the giveaway too: its default is Glass\'s Spotlight');
    assert.deepEqual(core.untouched('follow', old, 'follow-samurai'), old, 'a look was picked: what is saved is its settings');
    assert.deepEqual(core.untouched('yt_member', old, null), old);
    assert.deepEqual(core.untouched('follow', old, null), K.ownSettings(old), 'what the OBS overlay plays (kit.js ownSettings)');
  });
});

describe('the controls a look shows', () => {
  test('the samurai presets: the colour; the omikuji: the colour, the main text and the speed', () => {
    assert.deepEqual(core.controlsFor(K.styles['follow-samurai']), { accent: true, racing: false, label: false, speed: false, effect: true, sound: true, grows: false });
    assert.deepEqual(core.controlsFor(K.styles['giveaway-samurai']), { accent: true, racing: false, label: true, speed: true, effect: true, sound: true, grows: false });
  });

  test('Racing: its card, accent and name colours and the name\'s font; growing where it has an amount', () => {
    assert.deepEqual(core.controlsFor(K.styles['bits-racing']), { accent: false, racing: true, label: true, speed: true, effect: true, sound: true, grows: true });
    assert.equal(core.controlsFor(K.styles['follow-racing']).grows, false);
  });

  test('today\'s object and the C1: the sound only; a legacy card: nothing', () => {
    const OBJECTS = require('../public/overlay/objects/index.js');
    for (const look of [OBJECTS.follow, OBJECTS.STYLES['donation-c1']]) {
      assert.deepEqual(core.controlsFor(look), { accent: false, racing: false, label: false, speed: false, effect: false, sound: true, grows: false });
    }
    assert.deepEqual(core.controlsFor(null), { accent: false, racing: false, label: false, speed: false, effect: false, sound: false, grows: false });
  });
});

describe('the gallery', () => {
  const entries = [
    { id: 'donation-c1', family: null, mine: true },
    { id: 'donation-samurai', family: 'samurai', mine: false },
    { id: 'donation-racing', family: 'racing', mine: false },
    { id: 'donation-glass', family: 'glass', mine: false },
  ];

  test('a look made for the streamer first, then the alert\'s default look (Glass\'s), then the rest in family order', () => {
    assert.deepEqual(core.orderGallery(entries, 'donation', DEFAULT_STYLES), [
      { id: 'donation-c1', family: null, badge: 'mine' },
      { id: 'donation-glass', family: 'glass', badge: 'default' },
      { id: 'donation-samurai', family: 'samurai', badge: null },
      { id: 'donation-racing', family: 'racing', badge: null },
    ]);
  });

  test('every alert\'s default look is marked "default", the giveaway\'s too', () => {
    const giveaway = [{ id: 'giveaway-samurai', family: 'samurai', mine: false }, { id: 'giveaway-racing', family: 'racing', mine: false }, { id: 'giveaway-glass', family: 'glass', mine: false }];
    assert.deepEqual(core.orderGallery(giveaway, 'giveaway_winner', DEFAULT_STYLES).map((e) => [e.id, e.badge]),
      [['giveaway-glass', 'default'], ['giveaway-samurai', null], ['giveaway-racing', null]]);
  });

  test('a family filter keeps that family\'s looks; "all" keeps every look', () => {
    const ordered = core.orderGallery(entries, 'donation', DEFAULT_STYLES);
    assert.deepEqual(core.filterGallery(ordered, 'racing').map((e) => e.id), ['donation-racing']);
    assert.equal(core.filterGallery(ordered, 'all').length, 4);
  });
});

describe('what a save sends', () => {
  test('the alert, its design, and for the six the look the page shows', () => {
    assert.deepEqual(core.savePayload('follow', { card_width: 420 }, 'follow-racing'), { eventType: 'follow', design: { card_width: 420 }, style: 'follow-racing' });
    assert.deepEqual(core.savePayload('follow', {}, undefined), { eventType: 'follow', design: {}, style: null });
  });

  test('YouTube\'s alerts and timed messages send no look: the server keeps theirs as it is', () => {
    assert.deepEqual(core.savePayload('yt_member', {}, 'follow-racing'), { eventType: 'yt_member', design: {} });
  });
});

describe('the Sound row, by theme', () => {
  const groups = [
    { family: 'samurai', sounds: [{ key: 'samuraiBell', name: 'Temple bell' }, { key: 'samuraiBell.2', name: 'Temple bell (version 2)' }] },
    { family: 'racing', sounds: [{ key: 'rcFlyby', name: 'Fly-by' }, { key: 'rcFlyby.2', name: 'Fly-by (version 2)' }] },
  ];
  const racing = { key: 'follow-racing', family: 'racing' };

  test('shows the theme the streamer is browsing, else the saved sound\'s, else the look\'s own, else the first', () => {
    assert.equal(core.soundThemeOf('samurai', 'rcFlyby', racing, groups), 'samurai', 'browsing wins');
    assert.equal(core.soundThemeOf(null, 'samuraiBell.2', racing, groups), 'samurai', 'a second version belongs to its theme');
    assert.equal(core.soundThemeOf(null, null, racing, groups), 'racing', 'the look\'s own');
    assert.equal(core.soundThemeOf(null, 'today', { key: 'follow' }, groups), 'samurai', 'today\'s object has no family: the first');
    assert.equal(core.soundThemeOf('nope', 'nope', racing, groups), 'racing', 'an unknown theme or sound is passed over');
    assert.equal(core.soundThemeOf(null, null, null, []), null);
  });

  test('lists a theme\'s sounds in the page\'s order, each followed by its version 2', () => {
    assert.deepEqual(core.soundsOfTheme('racing', groups).map((s) => s.key), ['rcFlyby', 'rcFlyby.2']);
    assert.deepEqual(core.soundsOfTheme('nope', groups), []);
    const list = core.soundsOfTheme('racing', groups);
    list.pop();
    assert.equal(groups[1].sounds.length, 2, 'a copy: the page\'s groups stay as they are');
  });
});

test('dual export: a browser global with the same functions', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'builder-styles-core.js'), 'utf8'), { window });
  assert.deepEqual(Object.keys(window.ATLETA_BUILDER_STYLES).sort(), Object.keys(core).sort());
});
