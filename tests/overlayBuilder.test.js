'use strict';

// Guards on the overlay builder page (src/views/overlay-builder.ejs) that are about
// how the page behaves rather than what it saves (that is src/services/overlayDesign.test.js).
// The page is one inline script, so these read its source; the behaviours were also
// run in a real browser when they were written.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'overlay-builder.ejs'), 'utf8');

// The source of one function declaration, up to the next top-level function. It reads the builder
// unless given another file's source (the parity test reads overlay.js the same way).
function functionSource(name, source = builder) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `${name} exists`);
  const next = /\n(?:async )?function |\n\/\/ ─── /.exec(source.slice(match.index + 1));
  return source.slice(match.index, next ? match.index + 1 + next.index : undefined);
}

describe('the sponsor Scale slider', () => {
  const slider = builder.match(/<input type="range" min="0\.3" max="1" step="0\.05"[\s\S]*?>/)[0];

  test('follows the slider with the preview on every step, and saves only when it is let go', () => {
    assert.match(slider, /oninput="[^"]*previewSponsorScale\(\$\{s\.id\}, this\.value\)"/);
    assert.match(slider, /onchange="saveSponsorScale\(\$\{s\.id\}, this\.value\)"/);
  });

  test('nothing that runs on every input step talks to the server', () => {
    const oninput = slider.match(/oninput="([^"]*)"/)[1];
    assert.ok(!/saveSponsorScale|updateSponsorScale|fetch\(/.test(oninput), 'the input handler only previews');
    assert.ok(!functionSource('previewSponsorScale').includes('fetch('), 'previewing sends nothing');
  });

  test('the save is one request to the sponsor update route with the final scale', () => {
    const save = functionSource('saveSponsorScale');
    assert.equal(save.split('fetch(').length - 1, 1);
    assert.match(save, /\/dashboard\/sponsors\/\$\{id\}\/update/);
    assert.match(save, /image_scale: scale/);
  });

  test('the old handler that saved on every step is gone', () => {
    assert.ok(!builder.includes('updateSponsorScale('), 'no caller or definition is left');
  });
});

describe('"Solid (no gradient)"', () => {
  const overlayJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'overlay.js'), 'utf8');

  test('is the theme popup option named "solid", and no option has an empty value', () => {
    const select = builder.match(/<select id="modal-gradient-direction"[\s\S]*?<\/select>/)[0];
    const values = [...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(values.includes('solid'));
    assert.ok(!values.includes(''), 'an empty value is what the server could not keep');
    // The label is a translation key now; the English text is what the key holds.
    assert.match(select, /<option value="solid"><%= t\('overlayBuilder\.theme\.gradient\.solid'\) %><\/option>/);
    assert.equal(require('../src/locales/en.json')['overlayBuilder.theme.gradient.solid'], 'Solid (no gradient)');
  });

  test('the card preview and the theme popup preview each tell solid from a gradient by that name', () => {
    assert.equal(builder.split("gradDir !== 'solid'").length - 1, 2);
    assert.ok(!/if \(gradDir\) \{/.test(builder), 'no truthiness test is left in the builder');
  });

  test('so does the OBS overlay, with the same fallback for a missing direction', () => {
    assert.match(overlayJs, /const gradDir = design\.gradient_direction \|\| '160deg';/);
    assert.match(overlayJs, /if \(gradDir !== 'solid'\) \{/);
    assert.ok(!/if \(gradDir\) \{/.test(overlayJs));
    assert.match(builder, /const gradDir = d\.gradient_direction \|\| '160deg';/, 'the preview falls back the same way');
  });
});

describe('the card width slider', () => {
  const { FIELD_SPECS } = require('../src/services/overlayDesign');
  const PLACEMENT = require('../public/overlay/placement.js');
  const slider = builder.match(/<input type="range" id="ctrl-card-width"[^>]*>/)[0];
  const bound = (name) => Number(new RegExp(`${name}="(\\d+)"`).exec(slider)[1]);

  // Two places have set it wrong. It stopped at 700 while the server, the drag handle and placement.js
  // allow 900, so a card saved wider than 700 was set back to 700 the next time the page set the slider.
  // It started at 280 while they allow 200, so a card dragged to a width of 200 to 279 was saved as 280.
  test('spans the same widths as the server, the drag handle and the OBS overlay, at both ends', () => {
    const { min, max } = FIELD_SPECS.card_width;
    assert.deepEqual([bound('min'), bound('max')], [min, max], 'the slider and the server');
    const drag = /newWidth = Math\.max\((\d+), Math\.min\((\d+), newWidth\)\);/.exec(builder);
    assert.ok(drag, 'the drag handle clamps the width');
    assert.deepEqual([Number(drag[1]), Number(drag[2])], [min, max], 'the drag handle and the server');
    assert.deepEqual([PLACEMENT.MIN_WIDTH, PLACEMENT.MAX_WIDTH], [min, max], 'placement.js and the server');
  });

  test('has a step that lands on both ends, so neither is rounded away', () => {
    const step = bound('step');
    assert.equal((bound('max') - bound('min')) % step, 0);
  });

  test('starts at a width that is inside the range', () => {
    assert.ok(bound('value') >= bound('min') && bound('value') <= bound('max'));
  });

  test('is set from a saved width by setControlValues, which has no clamp of its own', () => {
    const set = functionSource('setControlValues');
    assert.match(set, /getElementById\('ctrl-card-width'\)\.value = d\.card_width \|\| 420;/);
    assert.ok(!/Math\.min\(\s*700/.test(builder), 'no 700 cap is left in the page');
  });
});

describe('the font picker', () => {
  // The first entry of the list is named by a translation ("System Default"); a font's own name is stored as it is.
  test('prints each name as text, not inside the markup it builds for the item', () => {
    const gallery = functionSource('buildFontGallery');
    assert.ok(!/class="font-name">[^<]/.test(gallery), 'the name is not written into the template');
    assert.match(gallery, /div\.querySelector\('\.font-name'\)\.textContent = f\.label \|\| f\.name;/);
  });

  test('keeps the stored name apart from the shown one', () => {
    assert.match(builder, /\{ name: 'System Default', label: I18N\.systemDefault,/, 'the stored name stays English, the label is the translation');
    assert.match(functionSource('buildFontGallery'), /div\.dataset\.font = f\.name;/);
  });
});

describe("an alert's saved style (andre_vilela_'s C1)", () => {
  const vm = require('node:vm');
  const OBJECTS = require('../public/overlay/objects/index.js');

  // previewObjectFor on its own, in a page that has the registry and the given stored styles.
  function pick(type, alertStyles) {
    const context = vm.createContext({ window: { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: OBJECTS.STYLES }, ALERT_STYLES: alertStyles });
    vm.runInContext(functionSource('previewObjectFor'), context);
    return vm.runInContext(`previewObjectFor(${JSON.stringify(type)})`, context);
  }

  test('the preview draws the object the overlay would: the C1 for a donation styled donation-c1', () => {
    assert.equal(pick('donation', { donation: 'donation-c1' }).key, 'donation-c1');
    assert.equal(pick('donation', {}).key, 'donation');
    assert.equal(pick('follow', { follow: 'donation-c1' }).key, 'follow', 'a style for another alert is ignored');
    assert.equal(pick('donation', { donation: 'donation-gp' }).key, 'donation', 'so is an unknown one');
    assert.equal(pick('donation', { donation: '__proto__' }).key, 'donation');
    assert.equal(pick('giveaway_winner', {}), null, 'a legacy card has no object');
  });

  test('the stored styles are read once from the server\'s designs, apart from the working copy', () => {
    assert.match(builder, /const ALERT_STYLES = \{\};\s*SERVER_DESIGNS\.forEach\(d => \{ if \(d\.style\) ALERT_STYLES\[d\.event_type\] = d\.style; \}\);/);
  });

  test('the preview and the controls use that pick, never the alert\'s own object directly', () => {
    assert.match(functionSource('updatePreview'), /const objDef = previewObjectFor\(currentType\);/);
    assert.match(functionSource('syncPhase1Controls'), /previewObjectFor\(currentType\)/);
    assert.ok(!/ATLETA_OBJECTS\[currentType\]/.test(builder), 'no lookup skips the style');
  });

  test('Reset and Discard leave the stored style alone (the server keeps it), and no save sends one', () => {
    for (const name of ['resetCurrentDesign', 'discardChanges', 'saveCurrentDesign']) {
      assert.ok(!functionSource(name).includes('ALERT_STYLES'), name);
    }
    assert.ok(!/\bstyle\s*:/.test(functionSource('getControlValues')), 'the saved payload has no style');
  });

  test('the car drives in from the edge of the preview screen (the 1920px canvas, scaled)', () => {
    assert.match(builder, /#preview-object-host \{[^}]*--fw: 1920px;/);
  });

  // previewObjectFor (the builder, from ALERT_STYLES) and objectFor (the OBS overlay, from overlayDesigns)
  // are two copies of one rule in two files. Each real source runs in its own context over the same
  // window, and the two picks are compared by identity: a change that reaches one copy only is named here.
  test('the preview and the OBS overlay pick the same object for every alert and style', () => {
    const overlayJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'overlay.js'), 'utf8');
    const previewSource = functionSource('previewObjectFor');
    const overlaySource = functionSource('objectFor', overlayJs);
    const pickPreview = (win, type, styleId) => {
      const alertStyles = styleId === undefined ? {} : { [type]: styleId };
      const context = vm.createContext({ window: win, ALERT_STYLES: alertStyles });
      vm.runInContext(previewSource, context);
      return vm.runInContext(`previewObjectFor(${JSON.stringify(type)})`, context);
    };
    const pickOverlay = (win, type, styleId) => {
      const designs = styleId === undefined ? {} : { [type]: { style: styleId } };
      const context = vm.createContext({ window: win, overlayDesigns: designs });
      vm.runInContext(overlaySource, context);
      return vm.runInContext(`objectFor(${JSON.stringify(type)})`, context);
    };

    const TYPES = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat'];
    const STYLE_IDS = [undefined, 'donation-c1', 'donation-gp', '__proto__', 'constructor', 'toString', 'follow'];
    const real = { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: OBJECTS.STYLES };
    // An alias whose key is not its style id: only the key clause keeps it from drawing the donation.
    const alias = { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: { 'donation-alias': { key: 'donation-c1', eventType: 'donation' } } };
    // The kit and the families, as both pages load them: the giveaway's default look comes from the kit.
    const KIT = require('../public/overlay/objects/kit.js');
    require('../public/overlay/objects/styles/samurai.js');
    require('../public/overlay/objects/styles/racing.js');
    const looks = { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: OBJECTS.STYLES, ATLETA_KIT: KIT };
    const registries = [
      { name: 'real styles', win: real, styleIds: STYLE_IDS },
      { name: 'synthetic styles', win: alias, styleIds: [...STYLE_IDS, 'donation-alias'] },
      { name: 'the looks with the kit', win: looks, styleIds: [...STYLE_IDS, 'giveaway-racing', 'giveaway-samurai', 'follow-racing', 'bits-racing', 'follow-samurai'] },
    ];
    for (const { name, win, styleIds } of registries) {
      for (const type of TYPES) {
        for (const styleId of styleIds) {
          const label = styleId === undefined ? 'none' : `"${styleId}"`;
          assert.strictEqual(pickPreview(win, type, styleId), pickOverlay(win, type, styleId),
            `${name}: type "${type}", style ${label}: the preview and the OBS overlay pick different objects`);
        }
      }
    }

    assert.strictEqual(pickPreview(alias, 'donation', 'donation-alias'), OBJECTS.donation, 'the preview draws the donation object, not the alias');
    assert.strictEqual(pickOverlay(alias, 'donation', 'donation-alias'), OBJECTS.donation, 'the OBS overlay draws the donation object, not the alias');
    // Not two nulls: both picks give the real C1 for its own style.
    assert.strictEqual(pickPreview(real, 'donation', 'donation-c1'), OBJECTS.STYLES['donation-c1'], 'the preview draws the C1');
    assert.strictEqual(pickOverlay(real, 'donation', 'donation-c1'), OBJECTS.STYLES['donation-c1'], 'the OBS overlay draws the C1');
    // Not two nulls either: the giveaway with no style is Racing's Victory lap in both.
    assert.equal(pickPreview(looks, 'giveaway_winner', undefined).key, 'giveaway-racing');
    assert.equal(pickOverlay(looks, 'giveaway_winner', undefined).key, 'giveaway-racing');
    assert.equal(pickPreview(looks, 'follow', undefined), OBJECTS.follow, 'the five keep today\'s object');
  });
});
