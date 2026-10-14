'use strict';

// A value a page puts into its own <script> as JSON (<%- JSON.stringify(...) %>) must not be able to
// end the script: a "<" in it is written \u003c. Every embed in the views does that, and this keeps it so.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const views = fs.readdirSync(VIEWS).filter((name) => name.endsWith('.ejs')).sort();
const ESCAPE = /\.replace\(\/<\/g,\s*'\\\\u003c'\)/;

describe('every JSON embed in a view escapes "<"', () => {
  test('the views have JSON embeds to check', () => {
    const total = views.reduce((sum, name) => sum + [...fs.readFileSync(path.join(VIEWS, name), 'utf8').matchAll(/<%-[\s\S]*?%>/g)].filter((tag) => tag[0].includes('JSON.stringify')).length, 0);
    assert.ok(total >= 18, `found ${total}`);
  });

  for (const name of views) {
    test(name, () => {
      const source = fs.readFileSync(path.join(VIEWS, name), 'utf8');
      const unescaped = [...source.matchAll(/<%-([\s\S]*?)%>/g)]
        .filter((tag) => tag[1].includes('JSON.stringify') && !ESCAPE.test(tag[1]))
        .map((tag) => `line ${source.slice(0, tag.index).split('\n').length}: ${tag[1].trim().replace(/\s+/g, ' ').slice(0, 70)}`);
      assert.deepEqual(unescaped, [], `${name} embeds JSON without .replace(/</g, '\\\\u003c')`);
    });
  }
});

describe('the VTuber page', () => {
  const HOSTILE = '</script><img src=x onerror=alert(1)>';
  const render = (locals) => ejs.render(fs.readFileSync(path.join(VIEWS, 'vtuber.ejs'), 'utf8'), { streamerName: 'Streamer', ...locals }, { filename: path.join(VIEWS, 'vtuber.ejs') });
  const scriptLine = (html, name) => html.split('\n').find((line) => line.includes(`const ${name} =`));

  test('puts the model URL and the mode into its script as JSON, and a value cannot end the script', () => {
    const html = render({ mode: 'stream', modelUrl: '/vtuber-models/7/avatar.vrm' });
    assert.equal(scriptLine(html, 'MODE').trim(), 'const MODE = "stream";');
    assert.equal(scriptLine(html, 'MODEL_URL').trim(), 'const MODEL_URL = "/vtuber-models/7/avatar.vrm";');

    const hostile = render({ mode: HOSTILE, modelUrl: HOSTILE });
    assert.ok(!hostile.includes(HOSTILE), 'the value is not on the page as it is');
    assert.equal(scriptLine(hostile, 'MODE').trim(), 'const MODE = "\\u003c/script>\\u003cimg src=x onerror=alert(1)>";');
    assert.equal(scriptLine(hostile, 'MODEL_URL').trim(), 'const MODEL_URL = "\\u003c/script>\\u003cimg src=x onerror=alert(1)>";');
  });

  test('a mode with a quote, a backslash or a line break is still one string in the script', () => {
    for (const mode of ["it's", 'a"b', 'back\\slash', 'two\nlines']) {
      const line = scriptLine(render({ mode, modelUrl: null }), 'MODE').trim();
      const value = new Function(`${line.replace(/^const MODE = /, 'return ')}`)();
      assert.equal(value, mode);
    }
  });

  test('without a model the script gets null', () => {
    assert.equal(scriptLine(render({ mode: 'dashboard', modelUrl: null }), 'MODEL_URL').trim(), 'const MODEL_URL = null;');
  });
});
