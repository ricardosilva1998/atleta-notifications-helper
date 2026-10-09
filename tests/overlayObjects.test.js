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
