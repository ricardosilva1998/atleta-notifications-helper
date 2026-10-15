'use strict';

// public/overlay/fx.js: the five screen effects the OBS overlay and the builder preview share.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FX = require('../public/overlay/fx.js');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'fx.css'), 'utf8');

test('the five effects, each at most 60 particles that run once', () => {
  assert.deepEqual(FX.KINDS, ['smoke', 'checker', 'speed', 'sparks', 'champagne']);
  for (const kind of FX.KINDS) {
    const list = FX.particles(kind, () => 0.5);
    assert.ok(list.length > 0 && list.length <= 60, `${kind}: ${list.length}`);
    for (const p of list) {
      assert.match(p.style, /--du:\d+\.\d\ds;--dd:\d+\.\d\ds/, `${kind}: a duration and a delay`);
      assert.ok(CSS.includes('.' + p.cls + '{') || CSS.includes('.' + p.cls + ','), `${kind}: .${p.cls} is styled in fx.css`);
    }
  }
  assert.deepEqual(FX.particles('none'), []);
});

test('a smaller preview gets smaller particles', () => {
  const full = FX.particles('smoke', () => 0.5, 1)[0].style, small = FX.particles('smoke', () => 0.5, 0.25)[0].style;
  assert.match(full, /width:370px/);
  assert.match(small, /width:93px/);
});

test('fx.css runs no animation forever', () => {
  assert.ok(!/infinite/.test(CSS));
});
