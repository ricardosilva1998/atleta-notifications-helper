'use strict';

// public/overlay/objects/kit.js: the helpers every look uses, the colour variables, and what a look
// is handed from a saved design (the OBS overlay and the builder preview both call these).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const K = require('../public/overlay/objects/kit.js');

describe('helpers', () => {
  test('esc escapes markup and quotes', () => {
    assert.equal(K.esc('<b a="1">\'&'), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
    assert.equal(K.esc(null), '');
  });

  test('a long name is set smaller, never below 0.6, and keeps its ellipsis class', () => {
    assert.equal(K.fitStyle('ABCDE', 5), '');
    assert.equal(K.fitStyle('ABCDEFGHIJ', 5), '--fit:0.60;');
    assert.equal(K.fitStyle('ABCDEFG', 6), '--fit:0.86;');
    assert.equal(K.nm('x', 'A<b>', 10), '<div class="x o-nm" style=""><span class="o-nm-t">A&lt;b&gt;</span></div>');
  });

  test('the odometer spins the units twice and the tens once', () => {
    const html = K.odo('42', 0.5, 0.6);
    assert.match(html, /^<span class="o-odo" style="--odel:0\.5s;--odur:0\.6s">/);
    assert.ok(html.includes('style="--to:14"'), 'the tens (4) after one turn');
    assert.ok(html.includes('style="--to:22"'), 'the units (2) after two turns');
  });

  test('typed text is one span per character, cut with an ellipsis', () => {
    const t = K.typed('a<b', 0.2, 0.05, 10);
    assert.equal(t.n, 3);
    assert.equal(t.html, '<span class="o-ch" style="--ti:0">a</span><span class="o-ch" style="--ti:1">&lt;</span><span class="o-ch" style="--ti:2">b</span>');
    assert.equal(K.typed('abcdef', 0, 0.1, 4).n, 4);
  });

  test('money writes the currency, and keeps what is not a number', () => {
    assert.equal(K.money('25', 'EUR'), '€25.00');
    assert.equal(K.money('abc', 'EUR'), 'EUR abc');
  });

  test('the same name always gives the same randomness', () => {
    const a = K.rng(K.hash('ApexAndre')), b = K.rng(K.hash('ApexAndre'));
    assert.equal(a(), b());
  });
});

describe('the streamer\'s colour', () => {
  test('gives the colour, its numbers, the text colour on it and its shades', () => {
    assert.equal(K.accentVars('#d81e26'),
      '--a:#D81E26;--a-rgb:216,30,38;--a-on:#FFFFFF;--a-on-rgb:255,255,255;--a-hi:#DF474D;--a-lo:#AD181E;--a-deep:#771115;--a-night:#3C080B;--a-ink:#1E0405;--a-soft:#E58286;--a-tint:#E77478;');
  });

  test('dark text on a light colour, white text on a dark one, also as numbers for translucent text', () => {
    assert.match(K.accentVars('#FFFFFF'), /--a-on:#0B0B12;--a-on-rgb:11,11,18;/);
    assert.match(K.accentVars('#FFC21A'), /--a-on:#0B0B12;--a-on-rgb:11,11,18;/);
    assert.match(K.accentVars('#000000'), /--a-on:#FFFFFF;--a-on-rgb:255,255,255;/);
  });

  test('nothing for a value that is not #rrggbb', () => {
    for (const value of [null, undefined, '', 'red', '#FFF', '#GGGGGG', 12]) assert.equal(K.accentVars(value), '', String(value));
  });
});

describe('what a look is handed', () => {
  const accentLook = { controls: { colour: 'accent', label: true, speed: true } };
  const racingLook = { controls: { colour: 'racing', label: true, speed: true } };
  const todayLook = { controls: { colour: 'accent', label: false, speed: false } };

  test('sizeOf: the real number, or the middle picture when "grows with the amount" is off', () => {
    assert.equal(K.sizeOf({ amount: 10000 }, 'bits'), 10000);
    assert.equal(K.sizeOf({ amount: 10000, grows: false }, 'bits'), 500);
    assert.equal(K.sizeOf({ viewers: 850, grows: false }, 'raid'), 42);
    assert.equal(K.sizeOf({ months: 27, grows: false }, 'months'), 4);
    assert.equal(K.sizeOf({ amount: '250.00', grows: false }, 'donation'), 25);
    assert.equal(K.sizeOf({ amount: 'abc' }, 'bits'), 0);
  });

  test('lookData: the main text, grows, and Racing\'s colours from today\'s columns', () => {
    const event = { username: 'A', amount: 5 };
    assert.deepEqual(K.lookData(accentLook, event, { style_label: 'Hi', style_grows: 0 }), { username: 'A', amount: 5, label: 'Hi', grows: false });
    assert.deepEqual(K.lookData(racingLook, event, { event_label: 'Pit', bg_color: '#111111', accent_color: '#222222', text_color: '#333333', username_font_family: 'Bangers' }),
      { username: 'A', amount: 5, label: 'Pit', colours: { bg: '#111111', accent: '#222222', name: '#333333', font: 'Bangers' }, grows: true });
    assert.deepEqual(K.lookData(todayLook, event, { style_label: 'ignored' }), { username: 'A', amount: 5, grows: true });
    assert.equal(event.label, undefined, 'the event itself is not changed');
  });

  test('slotVars: the colour and the speed for a look that takes them, nothing for today\'s five', () => {
    assert.deepEqual(K.slotVars(accentLook, { style_accent: '#29E0FF', animation_speed: 9 })['--spd'], '2');
    assert.equal(K.slotVars(accentLook, { style_accent: '#29E0FF' })['--a-hi'], '#50E6FF');
    assert.deepEqual(K.slotVars(todayLook, { style_accent: null, animation_speed: 1.5 }), {});
    assert.deepEqual(K.slotVars(racingLook, { style_accent: '#29E0FF', animation_speed: 0.2 }), { '--spd': '0.5' });
  });
});

describe('registering', () => {
  test('a look needs a known family, one of the six alerts and a render', () => {
    K.registerFamily({ key: 'kittest', order: 99, fonts: ['Some+Font:wght@700'] });
    assert.throws(() => K.register({ key: 'x', eventType: 'follow', family: 'nope', render() {} }), /family/);
    assert.throws(() => K.register({ key: 'x', eventType: 'yt_member', family: 'kittest', render() {} }), /six alert types/);
    assert.throws(() => K.register({ key: 'x', eventType: 'follow', family: 'kittest' }), /no render/);
    K.register({ key: 'follow-kittest', eventType: 'follow', family: 'kittest', render() { return ''; } });
    assert.equal(K.styles['follow-kittest'].family, 'kittest');
    assert.deepEqual(K.fontNames('kittest'), ['Some Font']);
    assert.ok(K.looksOf('follow').some((l) => l.key === 'follow-kittest'));
    assert.ok(!K.looksOf('donation').some((l) => l.key === 'donation-c1'), 'the C1 has no family and is not listed');
  });
});

describe('the default look, the effect and the sound', () => {
  const look = { key: 'follow-kitfx', family: 'kittest', fx: 'sparks', sound: 'kitBeep' };
  const ownObject = { key: 'follow' };

  test('the giveaway\'s default look is Racing\'s Victory lap; the five have none (today\'s object)', () => {
    assert.deepEqual(K.DEFAULT_LOOKS, { giveaway_winner: 'giveaway-racing' });
  });

  test('effectFor: none for today\'s objects and the C1, the design\'s effect or the look\'s own for a look', () => {
    assert.equal(K.effectFor(ownObject, { screen_effect: 'confetti' }), 'none', 'an untouched alert keeps no effect');
    assert.equal(K.effectFor(null, {}), 'none');
    assert.equal(K.effectFor(look, { screen_effect: 'default' }), 'sparks');
    assert.equal(K.effectFor(look, {}), 'sparks');
    assert.equal(K.effectFor(look, { screen_effect: 'gold' }), 'gold');
    assert.equal(K.effectFor(look, { screen_effect: 'none' }), 'none');
    assert.equal(K.effectFor({ family: 'kittest' }, null), 'none', 'a look without an effect of its own');
  });

  test('soundFor: the design\'s sound when known, else the look\'s own, else today\'s', () => {
    K.registerSound('kitBeep', 'kittest', () => {});
    assert.equal(K.soundFor(look, {}), 'kitBeep');
    assert.equal(K.soundFor(look, { style_sound: 'none' }), 'none');
    assert.equal(K.soundFor(look, { style_sound: 'today' }), 'today');
    assert.equal(K.soundFor(look, { style_sound: 'nope' }), 'kitBeep', 'an unknown sound falls back to the look\'s own');
    assert.equal(K.soundFor(look, { style_sound: '__proto__' }), 'kitBeep');
    assert.equal(K.soundFor(ownObject, {}), 'today');
    assert.equal(K.soundFor(null, null), 'today');
  });

  test('a sound belongs to a registered family', () => {
    assert.throws(() => K.registerSound('kitNope', 'nope', () => {}), /family/);
    K.registerSound('kitChime', 'kittest', () => {});
    assert.equal(K.soundFamilies.kitChime, 'kittest');
  });

  test('playSound plays a registered sound through the AudioContext it was given, and says false otherwise', () => {
    let played = 0;
    K.registerSound('kitCount', 'kittest', () => { played++; });
    K.setAudio(null);
    assert.equal(K.playSound('kitCount'), false, 'no AudioContext yet');
    K.setAudio({}, () => 0.5);
    assert.equal(K.playSound('kitCount'), true);
    assert.equal(K.playSound('nope'), false);
    assert.equal(played, 1);
    K.setAudio(null);
  });
});
