'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const OBJECTS = require('../public/overlay/objects/index.js');

const KEYS = ['follow', 'subscription', 'bits', 'donation', 'raid'];

describe('object registry contract', () => {
  test('exports exactly the five Twitch event types', () => {
    assert.deepEqual(Object.keys(OBJECTS).sort(), [...KEYS].sort());
  });

  test('every object has a render function and timing metadata', () => {
    for (const k of KEYS) {
      const o = OBJECTS[k];
      assert.equal(o.key, k, `${k}: key must match its registry slot`);
      assert.equal(typeof o.render, 'function', `${k}: render must be a function`);
      for (const phase of ['anim', 'exit']) {
        assert.ok(o[phase], `${k}: missing ${phase}`);
        assert.match(o[phase].dur, /^\d+(\.\d+)?s$/, `${k}: ${phase}.dur must be like "0.40s"`);
        assert.equal(typeof o[phase].ease, 'string', `${k}: ${phase}.ease must be a string`);
      }
      assert.equal(typeof o.anim.in, 'string', `${k}: anim.in must name a keyframe`);
      assert.equal(typeof o.exit.out, 'string', `${k}: exit.out must name a keyframe`);
    }
  });
});

const fs = require('node:fs');
const path = require('node:path');

describe('objects.css integrity', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1]));

  test('every keyframe named by the registry exists in objects.css', () => {
    const missing = [];
    for (const k of KEYS) {
      if (!defined.has(OBJECTS[k].anim.in)) missing.push(`${k}.anim.in=${OBJECTS[k].anim.in}`);
      if (!defined.has(OBJECTS[k].exit.out)) missing.push(`${k}.exit.out=${OBJECTS[k].exit.out}`);
    }
    assert.deepEqual(missing, [], 'keyframes referenced but not defined');
  });

  test('defines the shared positioning wrapper and blade', () => {
    assert.match(css, /\.alert-pos\s*\{/, '.alert-pos must exist — centering lives here, not in keyframes');
    assert.match(css, /\.o-blade\s*\{/, '.o-blade must exist — shared cut flash');
  });

  test('no object-internal class escapes its .o- prefix', () => {
    // Guards the collision that pinned the byobu frame rail to the wrong edge.
    const generic = ['.rail{', '.rail {', '.panel{', '.panel {', '.seal{', '.seal {'];
    for (const g of generic) {
      assert.ok(!css.includes(g), `bare generic selector "${g.trim()}" will collide on the builder page`);
    }
  });
});

describe('follow — iaido band', () => {
  test('renders the username and escapes HTML', () => {
    const html = OBJECTS.follow.render({ username: '<img src=x>Ap&x' });
    assert.ok(html.includes('&lt;img src=x&gt;Ap&amp;x'), 'must escape user input');
    assert.ok(!html.includes('<img src=x>'), 'must not emit raw user HTML');
  });

  test('includes the blade and scar elements the animation drives', () => {
    const html = OBJECTS.follow.render({ username: 'ApexAndre' });
    assert.match(html, /class="o-blade"/);
    assert.match(html, /class="o-follow-scar"/);
    assert.match(html, /class="obj o-follow"/);
  });
});

describe('subscription — torii gate', () => {
  test('puts the text inside the gaku plaque, not loose on the gate', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    const gakuAt = html.indexOf('o-sub-gaku');
    const nameAt = html.indexOf('RacerDan');
    assert.ok(gakuAt > -1, 'gaku plaque must exist — it is the legibility fix');
    assert.ok(nameAt > gakuAt, 'username must render inside the gaku');
  });

  test('renders tier and months when supplied', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    assert.match(html, /Tier 1/);
    assert.match(html, /4 months/);
  });

  test('omits the months clause when months is absent', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1' });
    assert.ok(!html.includes('months'), 'no months data means no months text');
  });
});

describe('bits — tally board', () => {
  test('emits one tile per digit, in order', () => {
    const html = OBJECTS.bits.render({ username: 'TurboTina', bits: 500 });
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.deepEqual(tiles, ['5', '0', '0']);
  });

  test('staggers each tile so they flip left to right', () => {
    const html = OBJECTS.bits.render({ username: 'TurboTina', bits: 500 });
    const delays = [...html.matchAll(/--rdelay:calc\(([\d.]+)s/g)].map(m => parseFloat(m[1]));
    assert.equal(delays.length, 3);
    assert.ok(delays[1] > delays[0] && delays[2] > delays[1], 'delays must increase left to right');
  });

  test('handles a single-digit amount', () => {
    const html = OBJECTS.bits.render({ username: 'T', bits: 1 });
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.deepEqual(tiles, ['1']);
  });
});
