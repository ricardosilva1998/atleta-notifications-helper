'use strict';

// Every look in public/overlay/objects/styles/ (docs/superpowers/specs/2026-10-15-alert-styles-design.md):
// it renders every sample without throwing and escapes what a viewer or the streamer typed, and its
// family's stylesheet follows the rules the OBS overlay needs. A new family is checked by adding its
// file and its prefixes (PREFIXES below).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OBJECTS_DIR = path.join(__dirname, '..', 'public', 'overlay', 'objects');
const STYLES_DIR = path.join(OBJECTS_DIR, 'styles');
const K = require(path.join(OBJECTS_DIR, 'kit.js'));
const FILES = fs.readdirSync(STYLES_DIR).sort();
FILES.filter((f) => f.endsWith('.js')).forEach((f) => require(path.join(STYLES_DIR, f)));
const OBJECTS_CSS = fs.readFileSync(path.join(OBJECTS_DIR, 'objects.css'), 'utf8');

// Each family's class and keyframe prefixes. Today's five keep their names (objects.css).
const PREFIXES = {
  samurai: { classes: ['o-omi'], keyframes: ['omi', 'exOmi'] },
  racing: { classes: ['o-rc'], keyframes: ['rc'] },
  grandprix: { classes: ['o-gp'], keyframes: ['gp'] },
  cockpit: { classes: ['o-ck'], keyframes: ['ck'] },
  arcade: { classes: ['o-ar'], keyframes: ['ar'] },
  quest: { classes: ['o-qs'], keyframes: ['qs'] },
  comic: { classes: ['o-cm'], keyframes: ['cm'] },
  cozy: { classes: ['o-cz'], keyframes: ['cz'] },
  cosmos: { classes: ['o-cs'], keyframes: ['cs'] },
  glass: { classes: ['o-gl'], keyframes: ['gl'] },
  spooky: { classes: ['o-spk'], keyframes: ['spk'] },
  cyber: { classes: ['o-cyb'], keyframes: ['cyb'] },
  western: { classes: ['o-wst'], keyframes: ['wst'] },
  retro: { classes: ['o-ros'], keyframes: ['ros'] },
  graffiti: { classes: ['o-gfi'], keyframes: ['gfi'] },
  kawaii: { classes: ['o-kwi'], keyframes: ['kwi'] },
  steampunk: { classes: ['o-stm'], keyframes: ['stm'] },
  frost: { classes: ['o-fro'], keyframes: ['fro'] },
  neon: { classes: ['o-neo'], keyframes: ['neo'] },
  deepsea: { classes: ['o-sea'], keyframes: ['sea'] },
  music: { classes: ['o-mus'], keyframes: ['mus'] },
  stadium: { classes: ['o-std'], keyframes: ['std'] },
  fireworks: { classes: ['o-fwk'], keyframes: ['fwk'] },
  dino: { classes: ['o-dno'], keyframes: ['dno'] },
  ufo: { classes: ['o-ufo'], keyframes: ['ufo'] },
  news: { classes: ['o-nws'], keyframes: ['nws'] },
};
// Classes a look may use from objects.css (shared parts and the samurai name plaque).
const SHARED = new Set(['obj', 'playing', 'exiting', 'alert-pos', 'look', 'o-nm', 'o-nm-t', 'o-odo', 'o-odo-d', 'o-odo-s', 'o-odo-strip',
  'o-typed', 'o-ch', 'o-name', 'o-name-text', 'o-meta', 'o-mesh']);

const LONG = 'TheLateBrakingLegend_2026';
const HOSTILE = '<img src=x onerror=alert(1)>"\'&';
const SAMPLES = {
  follow: [{}, {}, {}],
  subscription: [{ tier: '1', months: 1 }, { tier: '2', months: 4 }, { tier: '3', months: 27 }],
  bits: [{ amount: 50 }, { amount: 500 }, { amount: 10000 }],
  donation: [{ amount: '2.50', currency: 'EUR', message: '' }, { amount: '25.00', currency: 'EUR', message: 'Box box!' },
    { amount: '250.00', currency: 'EUR', message: 'Box box! New tyres for the whole season, and a coffee for the pit wall too. Send it!' }],
  raid: [{ viewers: 6 }, { viewers: 42 }, { viewers: 850 }],
  giveaway_winner: [{ prize: '' }, { prize: 'Season pass' }, { prize: 'A very long prize name that goes on and on' }],
};

const looks = K.ALERTS.flatMap((alert) => K.looksOf(alert));

// Splits CSS text on a separator outside brackets ("a calc(b / c), d" on ',' is two parts).
function splitTop(text, separator) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === separator && depth === 0) { if (current.trim()) parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// The classes of the elements holding a rolling number's digit cells (.o-odo-d), above its .o-odo.
// The cells clip to one digit, so a blurred text-shadow the digits inherit from one of these is cut
// into boxes; the glow belongs on the number as a drop-shadow, which is drawn after the clip.
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function digitHolders(html) {
  const stack = [], holders = new Set();
  for (const [, close, tag, attrs] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    if (close) { const at = stack.map((e) => e.tag).lastIndexOf(tag); if (at >= 0) stack.length = at; continue; }
    if (attrs.endsWith('/') || VOID.has(tag)) continue;
    const classes = ((attrs.match(/\bclass="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
    if (classes.includes('o-odo-d')) {
      const odo = stack.map((e) => e.classes.includes('o-odo')).lastIndexOf(true);
      stack.slice(0, odo < 0 ? stack.length : odo).forEach((e) => e.classes.forEach((c) => holders.add(c)));
    }
    stack.push({ tag, classes });
  }
  return holders;
}

describe('every look', () => {
  test('is registered for the six alerts, with its timing and its defaults', () => {
    assert.ok(looks.length > 0);
    for (const look of looks) {
      assert.ok(Object.hasOwn(PREFIXES, look.family) || look.preset, `${look.key}: add its family's prefixes to PREFIXES`);
      for (const phase of ['anim', 'exit']) {
        assert.equal(typeof look[phase].dur, 'string', `${look.key}: ${phase}.dur`);
        assert.match(look[phase].dur, /^\d+(\.\d+)?s$/, `${look.key}: ${phase}.dur like "0.40s" (exitMs() in overlay.js reads seconds)`);
      }
      assert.ok(typeof look.len === 'number' || typeof look.len === 'function', `${look.key}: len`);
      assert.equal(typeof look.sound, 'string', `${look.key}: sound`);
      assert.equal(typeof look.fx, 'string', `${look.key}: fx`);
      assert.ok(look.controls && 'colour' in look.controls, `${look.key}: controls`);
      assert.ok(look.controls.colour, `${look.key}: every look takes the streamer's colour`);
    }
  });

  test('every family has six looks, one for each alert', () => {
    for (const family of [...new Set(looks.map((look) => look.family))]) {
      assert.deepEqual(looks.filter((look) => look.family === family).map((look) => look.eventType).sort(), [...K.ALERTS].sort(), family);
    }
  });

  test('a look\'s own screen effect is one the overlay plays', () => {
    const { FIELD_SPECS } = require('../src/services/overlayDesign.js');
    const playable = FIELD_SPECS.screen_effect.values.filter((value) => value !== 'default');
    for (const look of looks) assert.ok(playable.includes(look.fx), `${look.key}: ${look.fx}`);
  });

  test('a look offers "grows with the amount" exactly when its picture is sized through K.sizeOf()', () => {
    // sizeOf() gives the middle picture while the switch is off; the text keeps the real number.
    for (const look of looks.filter((l) => !l.preset)) {
      const sized = /\bsizeOf\(/.test(String(look.render) + String(look.len));
      assert.equal(!!look.grows, sized, `${look.key}: grows is ${!!look.grows} but its picture ${sized ? 'is' : 'is not'} sized through sizeOf()`);
    }
  });

  test('a look offers its main text exactly when it draws it', () => {
    // The builder hides the control and kit.lookData() passes no style_label for a look without it. The
    // drawn text is read without the markup: a look may set its text one letter at a time (Graffiti's stencil).
    const MARK = 'QXMAINTEXT';
    for (const look of looks.filter((l) => !l.preset)) {
      const html = look.render(Object.assign({ username: 'ApexAndre', label: MARK }, SAMPLES[look.eventType][1]));
      const draws = html.replace(/<[^>]*>/g, '').includes(MARK);
      assert.equal(!!look.controls.label, draws, `${look.key}: offers the main text ${!!look.controls.label}, draws it ${draws}`);
    }
  });

  for (const look of looks) {
    test(`${look.key} renders every sample, and escapes what was typed`, () => {
      for (const sample of SAMPLES[look.eventType]) {
        for (const username of ['ApexAndre', LONG]) {
          for (const grows of [true, false]) {
            const html = look.render(Object.assign({ username, grows }, sample));
            assert.match(html, /^<div class="obj /, `${look.key} starts with its root`);
          }
        }
        const hostile = Object.assign({}, sample, { username: HOSTILE, label: HOSTILE },
          look.eventType === 'donation' ? { message: HOSTILE } : {}, look.eventType === 'giveaway_winner' ? { prize: HOSTILE } : {});
        const html = look.render(hostile);
        assert.ok(!html.includes('<img'), `${look.key}: a name, text, message or prize is escaped`);
      }
    });
  }
});

describe('every family stylesheet', () => {
  test('the digit-glow check finds the rolling digits (bits-racing holds them in .o-rcb-n)', () => {
    const html = K.styles['bits-racing'].render(Object.assign({ username: 'ApexAndre' }, SAMPLES.bits[1]));
    assert.ok(digitHolders(html).has('o-rcb-n'));
  });

  for (const file of FILES.filter((f) => f.endsWith('.css'))) {
    const family = file.replace(/\.css$/, '');
    const css = fs.readFileSync(path.join(STYLES_DIR, file), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

    test(`${file}: its classes and keyframes carry the family's prefixes`, () => {
      const prefixes = PREFIXES[family];
      assert.ok(prefixes, `add ${family} to PREFIXES`);
      const own = (cls) => SHARED.has(cls) || prefixes.classes.some((p) => cls.startsWith(p));
      const selectors = rules.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').match(/[^{}]+(?=\{)/g) || [];
      // Every compound selector (.o-rcb-seg.on) carries one of the family's classes, so a modifier
      // such as .on only ever applies inside the family.
      for (const selector of selectors) {
        for (const compound of selector.split(/[\s>+~,]+/)) {
          const classes = (compound.match(/\.([A-Za-z][\w-]*)/g) || []).map((c) => c.slice(1));
          if (classes.length) assert.ok(classes.some(own), `${file}: ${compound} has no class of its own family`);
        }
      }
      for (const [, name] of rules.matchAll(/@keyframes\s+([\w-]+)/g)) {
        assert.ok(prefixes.keyframes.some((p) => name.startsWith(p)), `${file}: @keyframes ${name}`);
      }
    });

    test(`${file}: animations run under .playing, every time divided by --spd, every keyframe defined`, () => {
      const defined = new Set([...(rules + OBJECTS_CSS).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
      for (const [, selector, body] of rules.matchAll(/([^{}]+)\{([^{}]*animation:[^{}]*)\}/g)) {
        if (/@keyframes/.test(selector)) continue;
        assert.match(selector.trim(), /^\.(playing|exiting)\b/, `${file}: ${selector.trim()} animates outside .playing/.exiting`);
        const value = body.match(/animation:([^;]+)/)[1];
        for (const part of splitTop(value, ',')) {
          const words = splitTop(part.trim(), ' ');
          assert.ok(defined.has(words[0]), `${file}: @keyframes ${words[0]} is not defined`);
          for (const word of words.slice(1)) {
            if (/^\d*\.?\d+m?s$/.test(word)) assert.fail(`${file}: ${selector.trim()}: ${word} is not divided by var(--spd)`);
            if (word.startsWith('calc(')) assert.ok(word.includes('var(--spd)'), `${file}: ${selector.trim()}: ${word} is not divided by var(--spd)`);
          }
        }
      }
    });

    test(`${file}: nothing OBS's Chromium lacks, and no selector reaching inside a shared part`, () => {
      for (const feature of [':has(', 'color-mix(', '@container', '@property', 'backdrop-filter']) assert.ok(!rules.includes(feature), `${file}: ${feature}`);
      const selectors = rules.match(/[^{}]+(?=\{)/g) || [];
      for (const s of selectors) assert.ok(!/(^|[\s,])\.[\w-]+\s+(i|span|div)\b/.test(s), `${file}: ${s.trim()} reaches inside other parts`);
    });

    test(`${file}: a rolling number's glow is a drop-shadow on its .o-odo, never a text-shadow its clipped digits inherit`, () => {
      const vars = Object.fromEntries([...rules.matchAll(/--([\w-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
      const resolve = (value) => { for (let i = 0; i < 5; i++) value = value.replace(/var\(--([\w-]+)\)/g, (m, name) => vars[name] || m); return value; };
      // A text-shadow with a blur: any layer whose third length is above 0.
      const blurred = (value) => resolve(value).trim() !== 'none' && splitTop(resolve(value), ',').some((layer) => {
        const lengths = splitTop(layer, ' ').filter((w) => /^-?(\d*\.)?\d+(px|em|rem)?$/.test(w));
        return parseFloat(lengths[2] || '0') > 0;
      });
      const keyframes = {};
      for (const m of rules.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) keyframes[m[1]] = m[2];
      const plain = rules.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
      const list = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sels: splitTop(sel, ','), body }));
      const subject = (sel) => (sel.trim().split(/[\s>+~]+/).pop().match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
      const shadowOf = (body) => (body.match(/(?:^|;)\s*text-shadow:([^;]+)/) || [])[1];
      const animatesGlow = (body) => {
        const animation = (body.match(/animation:([^;]+)/) || [])[1];
        return !!animation && splitTop(animation, ',').some((part) => {
          const frames = keyframes[splitTop(part.trim(), ' ')[0]];
          return !!frames && [...frames.matchAll(/text-shadow:([^;}]+)/g)].some((m) => blurred(m[1]));
        });
      };
      const holders = new Set(looks.filter((l) => l.family === family).flatMap((look) => SAMPLES[look.eventType]
        .flatMap((sample) => [...digitHolders(look.render(Object.assign({ username: 'ApexAndre' }, sample)))])));
      for (const { sels, body } of list) {
        const shadow = shadowOf(body);
        if (!((shadow !== undefined && blurred(shadow)) || animatesGlow(body))) continue;
        for (const sel of sels) {
          assert.ok(!subject(sel).some((c) => ['o-odo', 'o-odo-d', 'o-odo-strip'].includes(c)), `${file}: ${sel.trim()} gives the rolling digits a blurred text-shadow`);
          for (const holder of subject(sel).filter((c) => holders.has(c))) {
            const reset = list.some((r) => shadowOf(r.body) !== undefined && !blurred(shadowOf(r.body)) && r.sels.some((s) => subject(s).includes('o-odo')
              && new RegExp('\\.' + holder + '(?![\\w-])').test(s.trim().replace(/\.o-odo$/, ''))));
            assert.ok(reset, `${file}: .${holder} gives the rolling digits a blurred text-shadow, which their clipped cells cut into boxes: add "${sel.trim()} .o-odo{text-shadow:none;filter:drop-shadow(…)}"`);
          }
        }
      }
    });

    test(`${file}: no rule sets the same property twice (the second one silently wins)`, () => {
      const plain = rules.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
      for (const [, selector, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const props = splitTop(body, ';').map((d) => d.split(':')[0].trim()).filter((name) => name && !name.startsWith('--'));
        const twice = props.find((name, i) => props.indexOf(name) !== i);
        assert.ok(!twice, `${file}: ${selector.trim()} sets ${twice} twice`);
      }
    });

    test(`${file}: every look takes the streamer's colour on its own parts`, () => {
      // The accent tokens: --a itself and every family token defined from it (--rca:var(--a,…)).
      const tokens = new Set(['a', 'r-red', ...[...rules.matchAll(/--([\w-]+):var\(--a\b/g)].map((m) => m[1])]);
      const usesAccent = (body) => [...body.matchAll(/var\(--([\w-]+)/g)].some((m) => tokens.has(m[1]) || m[1].startsWith('a-'));
      for (const look of looks.filter((l) => l.family === family)) {
        // Today's five are drawn by objects.css; every other look by its family's stylesheet.
        const sheet = look.preset ? OBJECTS_CSS.replace(/\/\*[\s\S]*?\*\//g, '') : rules;
        const html = look.render(Object.assign({ username: 'ApexAndre' }, SAMPLES[look.eventType][1]));
        const own = new Set((html.match(/class="([^"]+)"/g) || []).flatMap((c) => c.slice(7, -1).split(/\s+/)).filter((c) => !SHARED.has(c)));
        const coloured = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selector, body]) => [...own].some((c) => new RegExp('\\.' + c + '(?![\\w-])').test(selector)) && usesAccent(body));
        assert.ok(coloured, `${look.key}: none of its parts use the accent`);
      }
    });
  }
});

describe('Racing keeps today\'s defaults', () => {
  test('each alert\'s colours and text are EVENT_DEFAULTS\'s', () => {
    const { EVENT_DEFAULTS } = require('../src/services/overlayDesign');
    const defaults = K.families.racing.defaults;
    for (const alert of K.ALERTS) {
      assert.equal(defaults[alert].bg, EVENT_DEFAULTS[alert].bg_color, `${alert} card`);
      assert.equal(defaults[alert].accent, EVENT_DEFAULTS[alert].accent_color, `${alert} accent`);
      assert.equal(defaults[alert].label, EVENT_DEFAULTS[alert].event_label, `${alert} text`);
    }
  });

  test('a saved design\'s colours and font reach the look; anything else falls back', () => {
    const look = K.styles['follow-racing'];
    const html = look.render({ username: 'A', colours: { bg: '#123456', accent: '#ABCDEF', name: '#FEDCBA', font: 'Bangers' } });
    assert.match(html, /--rc-bg:#123456;/);
    assert.match(html, /--rc-a:#ABCDEF;/);
    assert.match(html, /--rc-ink:#FEDCBA;/);
    assert.match(html, /--rc-font:&quot;Bangers&quot;;/);
    const odd = look.render({ username: 'A', colours: { bg: 'red', accent: null, font: 'x";}body{' } });
    assert.match(odd, /--rc-bg:#1a1a3e;--rc-bg2:rgb\(8,8,19\);--rc-a:#8888cc;/);
    assert.ok(!odd.includes('--rc-font'), 'a font that is not a plain name is left out');
  });

  test('with "grows with the amount" off, the nitro gauge is the middle one', () => {
    const lit = (d) => (K.styles['bits-racing'].render(d).match(/o-rcb-seg on/g) || []).length;
    assert.equal(lit({ username: 'A', amount: 10000, grows: false }), lit({ username: 'A', amount: 500 }));
    assert.ok(lit({ username: 'A', amount: 10000 }) > lit({ username: 'A', amount: 500 }));
  });
});

describe('text drawn on the streamer\'s colour reads --a-on (dark on a light colour), white while none is picked', () => {
  const css = fs.readFileSync(path.join(STYLES_DIR, 'grandprix.css'), 'utf8');
  const rule = (selector) => (css.match(new RegExp('(?:^|\\n)' + selector.replace(/\./g, '\\.') + '\\{([^}]*)\\}')) || [])[1] || '';
  test('Grand Prix: the timing tower\'s header and own row, the radio\'s amount and the winner\'s step', () => {
    for (const selector of ['.o-gps-head', '.o-gps-row.me', '.o-gpd-amt']) {
      assert.match(rule(selector), /(^|;)color:var\(--a-on,#fff\)/, selector);
    }
    assert.match(rule('.o-gpg-step.p1'), /(^|;)color:rgba\(var\(--a-on-rgb,255,255,255\),\.85\)/, '.o-gpg-step.p1');
  });
});
