'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const TIP_VOICE = require('../public/overlay/tipVoiceTiming.js');
const { voiceHoldMs, VOICE_START_MS, VOICE_TAIL_MS, ALERT_MAX_MS } = TIP_VOICE;

describe('how long a tip stays for its voice', () => {
  test('the alert stays for the voice, never past 30 s', () => {
    assert.equal(voiceHoldMs(12000, 4), 12000);
    assert.equal(voiceHoldMs(8000, 9), 10300);
    assert.equal(voiceHoldMs(8000, 60), 30000);
    assert.equal(voiceHoldMs(8000, NaN), 8000);
  });

  test('the constants: the voice starts 1 s in, the alert lingers 0.3 s after it, 30 s at most', () => {
    assert.deepEqual([VOICE_START_MS, VOICE_TAIL_MS, ALERT_MAX_MS], [1000, 300, 30000]);
  });

  test('a voice length that is not a number leaves the alert as it was', () => {
    for (const bad of [undefined, null, '4', Infinity, -Infinity]) assert.equal(voiceHoldMs(8000, bad), 8000, String(bad));
  });

  test('a short reading never shortens the streamer duration; a longer one stretches it by the exact margin', () => {
    assert.equal(voiceHoldMs(8000, 0), 8000);
    assert.equal(voiceHoldMs(8000, 6.7), 8000);
    assert.equal(voiceHoldMs(8000, 6.8), 8100);
  });

  test('exposes one global and no stray names', () => {
    assert.deepEqual(Object.keys(TIP_VOICE).sort(), ['ALERT_MAX_MS', 'VOICE_START_MS', 'VOICE_TAIL_MS', 'voiceHoldMs']);
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'tipVoiceTiming.js'), 'utf8'), sandbox);
    assert.equal(typeof sandbox.window.ATLETA_TIP_VOICE.voiceHoldMs, 'function');
  });
});
