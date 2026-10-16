'use strict';

// public/js/builder-styles-core.js: the Overlay Builder's Style section, the parts that need no page.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../public/js/builder-styles-core.js');
const K = require('../public/overlay/objects/kit.js');
require('../public/overlay/objects/styles/samurai.js');
require('../public/overlay/objects/styles/racing.js');
const { DEFAULT_STYLES, soundGroups, secondVersionOf } = require('../src/services/alertStyles');

// Requiring alertStyles loads every family and the sounds' manifest into the kit, so K.styles holds all
// 156 looks and the '.2' keys exist. The builder's STYLE_DATA.sounds, as builderStyleData() builds it
// (src/routes/dashboard.js), with the keys as names.
const STYLE_DATA_SOUNDS = soundGroups().map(({ family, sounds }) => ({
  family,
  sounds: sounds.flatMap((key) => (secondVersionOf(key) ? [{ key, name: key }, { key: secondVersionOf(key), name: key + ' (version 2)' }] : [{ key, name: key }])),
}));

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

describe('the cards', () => {
  test('there are ten, the six styled alerts first', () => {
    assert.deepEqual(core.CARD_TYPES, ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'timed', 'yt_superchat', 'yt_member', 'yt_giftmember']);
  });
  test('each card has its tabs', () => {
    assert.deepEqual(core.tabsFor('follow'), ['animation', 'customize', 'sound', 'location']);
    assert.deepEqual(core.tabsFor('giveaway_winner'), ['animation', 'customize', 'sound', 'location']);
    assert.deepEqual(core.tabsFor('timed'), ['images', 'design', 'location']);
    assert.deepEqual(core.tabsFor('yt_member'), ['design', 'location']);
    assert.deepEqual(core.tabsFor('nope'), []);
  });
  test('?tab= opens a card that is shown, and nothing else', () => {
    const shown = ['follow', 'donation', 'timed'];
    assert.equal(core.cardForTab('timed', shown), 'timed');
    assert.equal(core.cardForTab('donation', shown), 'donation');
    assert.equal(core.cardForTab('yt_member', shown), null);
    assert.equal(core.cardForTab('<x>', shown), null);
    assert.equal(core.cardForTab(null, shown), null);
  });
});

describe('sounds by alert', () => {
  const owners = core.soundOwners(K.styles);
  test('every look sound belongs to one look, and so to one alert', () => {
    assert.equal(Object.keys(owners).length, 156);
    assert.equal(core.ownerOfSound('glFollow', owners).eventType, 'follow');
    assert.equal(core.ownerOfSound('glFollow.2', owners).look.key, 'follow-glass');
    assert.equal(core.ownerOfSound('today', owners), null);
  });
  test('an alert lists only its own looks\' sounds, by theme, each with its version 2', () => {
    const groups = core.soundGroupsFor('follow', STYLE_DATA_SOUNDS, owners);
    assert.equal(groups.length, 26);
    for (const g of groups) for (const s of g.sounds) assert.equal(core.ownerOfSound(s.key, owners).eventType, 'follow', s.key);
    assert.deepEqual(groups.find((g) => g.family === 'glass').sounds.map((s) => s.key), ['glFollow', 'glFollow.2']);
  });
});

describe('"This look" rows', () => {
  const look = K.styles['bits-glass'];
  const alertGroups = () => core.soundGroupsFor('bits', STYLE_DATA_SOUNDS, core.soundOwners(K.styles));
  test('its own sound, its version 2, the classic engine sound, no sound', () => {
    assert.deepEqual(core.thisLookRows(look, null, STYLE_DATA_SOUNDS, alertGroups()),
      [{ key: 'glBits', tag: 'own' }, { key: 'glBits.2', tag: 'second' }, { key: 'today', tag: 'today' }, { key: 'none', tag: 'none' }]);
  });
  test('a saved sound of another alert comes first as "current", and is kept', () => {
    assert.deepEqual(core.thisLookRows(look, 'glFollow', STYLE_DATA_SOUNDS, alertGroups())[0], { key: 'glFollow', tag: 'current' });
  });
  test('a saved sound the alert lists anyway is not repeated', () => {
    for (const saved of ['glBits.2', 'today', 'none', 'rcNitro']) {
      assert.ok(!core.thisLookRows(look, saved, STYLE_DATA_SOUNDS, alertGroups()).some((r) => r.tag === 'current'), saved);
    }
  });
});

describe('loops and places', () => {
  test('speed is the design\'s, clamped, only for looks that take one', () => {
    assert.equal(core.speedOf({ controls: { speed: true } }, { animation_speed: 3 }), 2);
    assert.equal(core.speedOf({ controls: { speed: true } }, { animation_speed: 0.1 }), 0.5);
    assert.equal(core.speedOf({ controls: {} }, { animation_speed: 2 }), 1);
  });
  test('entrance and exit times at the speed; an exit takes at least 400 ms', () => {
    assert.deepEqual(core.loopTimings({ anim: { dur: '0.9s' }, exit: { dur: '0.36s' } }, 1), { inMs: 900, exitMs: 400 });
    assert.deepEqual(core.loopTimings({ anim: { dur: '1.2s' }, exit: { dur: '0.84s' } }, 0.5), { inMs: 2400, exitMs: 1680 });
    assert.deepEqual(core.loopTimings({ anim: { dur: '1s' } }, 1), { inMs: 1000, exitMs: 400 });
  });
  test('where an alert sits', () => {
    assert.deepEqual(core.placeSummary({}), { free: false, position: 'top-center', cell: 1 });
    assert.deepEqual(core.placeSummary({ card_position: 'bot-right' }), { free: false, position: 'bot-right', cell: 8 });
    assert.deepEqual(core.placeSummary({ card_position: 'mid-left', card_custom_x: 0.2, card_custom_y: 0.4 }), { free: true, position: 'mid-left', cell: -1 });
  });
  test('a dragged alert stays on the screen', () => {
    assert.deepEqual(core.clampFree(-50, -10, 420, 120), { x: 0, y: 0 });
    assert.deepEqual(core.clampFree(1900, 1070, 420, 120), { x: Math.round(1500 / 1920 * 1000) / 1000, y: Math.round(960 / 1080 * 1000) / 1000 });
    assert.deepEqual(core.clampFree(960, 540, 420, 120), { x: 0.5, y: 0.5 });
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
