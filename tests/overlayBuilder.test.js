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
    assert.match(builder, /const SAVED_STYLES = Object\.assign\(\{\}, ALERT_STYLES\);/, 'and kept as saved, apart from the look the page shows');
  });

  test('the preview and the controls use that pick, never the alert\'s own object directly', () => {
    assert.match(functionSource('updatePreview'), /const objDef = previewObjectFor\(currentType\);/);
    assert.match(functionSource('syncPhase1Controls'), /previewObjectFor\(currentType\)/);
    assert.ok(!/ATLETA_OBJECTS\[currentType\]/.test(builder), 'no lookup skips the style');
  });

  test('a save sends the look the page shows next to the design; Discard and Reset put back the saved look', () => {
    assert.match(functionSource('saveCurrentDesign'), /STYLE_CORE\.savePayload\(currentType, design, style\)/);
    assert.match(functionSource('saveCurrentDesign'), /SAVED_STYLES\[currentType\] = ALERT_STYLES\[currentType\] = style/);
    for (const name of ['discardChanges', 'resetCurrentDesign']) assert.match(functionSource(name), /restoreSavedLook\(currentType\)/, name);
    assert.ok(!/\bstyle\s*:/.test(functionSource('getControlValues')), 'the look travels next to the design, not in it');
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

describe('the Style section (alert styles)', () => {
  const vm = require('node:vm');

  test('Test plays the look in OBS without a thank-you in the Twitch chat (chat: false)', () => {
    assert.match(functionSource('testLook'), /body: JSON\.stringify\(\{ chat: false \}\)/);
  });

  test('"Use <family> for all six" keeps every tab\'s unsaved edits: only the look and its settings come from the server', () => {
    const source = functionSource('useStyleFamily');
    assert.match(source, /workingDesigns\[type\] = STYLE_CORE\.lookApplied\(/);
    assert.ok(!source.includes('workingDesigns[type] = Object.assign({}, EVENT_DEFAULTS[type], row)'), 'the saved row no longer replaces the working design');
  });

  test('opens the six alerts\' tabs, above the card controls it replaces', () => {
    const style = builder.indexOf('id="section-style"');
    assert.ok(style > 0 && style < builder.indexOf('id="section-theme"'));
    assert.ok(!builder.includes('phase1-notice'), 'the notice saying colours would come back is gone: they are here');
  });

  test('a control the look does not take is really hidden (its row\'s display rule does not win over [hidden])', () => {
    assert.match(builder, /#section-style \[hidden\] \{ display: none; \}/);
  });

  test('the page loads the core and every family\'s fonts in one stylesheet', () => {
    assert.match(builder, /<script src="\/js\/builder-styles-core\.js"><\/script>/);
    assert.match(builder, /<link rel="stylesheet" href="<%= styleFontsHref %>">/);
  });

  test('an alert nobody has restyled is shown with its look\'s own settings', () => {
    assert.match(builder, /STYLE_CORE\.STYLED_ALERTS\.forEach\(t => \{ workingDesigns\[t\] = STYLE_CORE\.untouched\(t, workingDesigns\[t\], SAVED_STYLES\[t\]\); \}\);/);
  });

  test('a picked look starts from its own settings and is drawn again', () => {
    const src = functionSource('pickLook');
    assert.match(src, /STYLE_CORE\.withLook\(getControlValues\(\), previous, id\)/);
    assert.match(src, /renderedObjectType = null/);
  });

  test('the controls write the fields the save sends, and mirror today\'s hidden controls', () => {
    const src = functionSource('initStyleControls');
    for (const [id, mirror] of [['style-speed', 'ctrl-animation-speed'], ['style-effect', 'ctrl-screen-effect'], ['style-racing-card', 'ctrl-bg-color'], ['style-racing-accent', 'ctrl-accent-color']]) {
      assert.ok(src.includes(`'${id}'`) && src.includes(`'${mirror}'`), `${id} -> ${mirror}`);
    }
    const values = functionSource('getControlValues');
    for (const field of ['style_accent', 'style_label', 'style_sound', 'style_grows']) assert.ok(values.includes(`${field}:`), field);
  });

  test('the preview draws a look with its design, as OBS does, and scales a look of the styles to the width', () => {
    const K = require('../public/overlay/objects/kit.js');
    require('../public/overlay/objects/styles/samurai.js');
    require('../public/overlay/objects/styles/racing.js');
    const context = vm.createContext({ window: { ATLETA_KIT: K } });
    vm.runInContext(functionSource('lookHtml') + functionSource('sizeLookHost'), context);
    const html = vm.runInContext(`lookHtml(window.ATLETA_KIT.styles['follow-racing'], { event_label: 'Pit crew!' }, { username: 'ApexAndre' })`, context);
    assert.match(html, />Pit crew!</, 'Racing\'s main text is the design\'s event_label');
    assert.equal(vm.runInContext(`lookHtml({ key: 'x', family: 'samurai', render() { throw new Error('boom'); } }, {}, {})`, context), null, 'a look that throws draws nothing');
    const host = { classes: new Set(), props: {} };
    host.classList = { toggle: (c, on) => (on ? host.classes.add(c) : host.classes.delete(c)) };
    host.style = { setProperty: (n, v) => { host.props[n] = v; }, removeProperty: (n) => { delete host.props[n]; } };
    context.host = host;
    vm.runInContext(`sizeLookHost(host, window.ATLETA_KIT.styles['raid-racing'], 630)`, context);
    assert.ok(host.classes.has('look'));
    assert.equal(host.props['--zw'], '1.5');
    vm.runInContext(`sizeLookHost(host, window.ATLETA_KIT.styles['raid-samurai'], 630)`, context);
    assert.ok(!host.classes.has('look'), 'today\'s looks reflow');
    assert.match(builder, /#preview-object-host\.look > \.obj \{ width: 420px; zoom: var\(--zw, 1\); \}/);
  });
});
