'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const PLACEMENT = require('../public/overlay/placement.js');
const { placementOf, slotStyle } = PLACEMENT;

const POSITIONS = ['top-left', 'top-center', 'top-right', 'mid-left', 'mid-center', 'mid-right', 'bot-left', 'bot-center', 'bot-right'];

describe('placementOf: reading a saved design', () => {
  test('no design at all is top-centre, 420px wide', () => {
    for (const nothing of [undefined, null, {}]) {
      assert.deepEqual(placementOf(nothing), { width: 420, vertical: 'top', horizontal: 'center', custom: null });
    }
  });

  test('every grid cell the builder offers is understood', () => {
    for (const position of POSITIONS) {
      const [vertical, horizontal] = position.split('-');
      assert.deepEqual(placementOf({ card_position: position }), { width: 420, vertical, horizontal, custom: null }, position);
    }
  });

  test('a position it does not know falls back to the default for the part it cannot read', () => {
    assert.deepEqual(placementOf({ card_position: 'nowhere' }), { width: 420, vertical: 'top', horizontal: 'center', custom: null });
    assert.deepEqual(placementOf({ card_position: 'bot-' }).vertical, 'bot');
    assert.deepEqual(placementOf({ card_position: 'bot-' }).horizontal, 'center');
    assert.deepEqual(placementOf({ card_position: 5 }).vertical, 'top');
    assert.deepEqual(placementOf({ card_position: '__proto__-constructor' }), { width: 420, vertical: 'top', horizontal: 'center', custom: null });
  });

  test('the width is the saved one, whole pixels, held to 200-900', () => {
    assert.equal(placementOf({ card_width: 600 }).width, 600);
    assert.equal(placementOf({ card_width: 333.4 }).width, 333);
    assert.equal(placementOf({ card_width: 5 }).width, 200);
    assert.equal(placementOf({ card_width: 5000 }).width, 900);
    assert.equal(placementOf({ card_width: 200 }).width, 200);
    assert.equal(placementOf({ card_width: 900 }).width, 900);
  });

  test('a width that is missing or not a number is the default 420', () => {
    for (const bad of [undefined, null, '', 'wide', '600', NaN, Infinity, -Infinity, {}, []]) {
      assert.equal(placementOf({ card_width: bad }).width, 420, String(bad));
    }
  });

  test('a dragged position is the saved fraction of the screen', () => {
    assert.deepEqual(placementOf({ card_custom_x: 0.25, card_custom_y: 0.5 }).custom, { x: 0.25, y: 0.5 });
  });

  test('0 is a real position (a card dragged to the very top-left corner)', () => {
    assert.deepEqual(placementOf({ card_custom_x: 0, card_custom_y: 0 }).custom, { x: 0, y: 0 });
    assert.deepEqual(placementOf({ card_custom_x: 0, card_custom_y: 0.4 }).custom, { x: 0, y: 0.4 });
  });

  test('a dragged position needs both numbers, and is held to 0-1', () => {
    assert.equal(placementOf({ card_custom_x: 0.5 }).custom, null);
    assert.equal(placementOf({ card_custom_x: 0.5, card_custom_y: null }).custom, null);
    assert.equal(placementOf({ card_custom_x: null, card_custom_y: null }).custom, null);
    assert.equal(placementOf({ card_custom_x: 'a', card_custom_y: 0.5 }).custom, null);
    assert.equal(placementOf({ card_custom_x: NaN, card_custom_y: 0.5 }).custom, null);
    assert.deepEqual(placementOf({ card_custom_x: -3, card_custom_y: 7 }).custom, { x: 0, y: 1 });
  });
});

describe('slotStyle: the style that puts an alert where its design says', () => {
  const styleFor = (design) => slotStyle(placementOf(design));

  test('the default is where the objects always sat: 16px from the top, centred, 420px', () => {
    assert.deepEqual(styleFor({}), {
      width: '420px', maxWidth: '96%', top: '16px', right: 'auto', bottom: 'auto', left: '50%', transform: 'translate(-50%, 0)',
    });
  });

  test('every grid cell puts the slot against the right edges, 16px in', () => {
    const expected = {
      'top-left':   { top: '16px', left: '16px', right: 'auto', bottom: 'auto', transform: 'none' },
      'top-center': { top: '16px', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%, 0)' },
      'top-right':  { top: '16px', right: '16px', left: 'auto', bottom: 'auto', transform: 'none' },
      'mid-left':   { top: '50%', left: '16px', right: 'auto', bottom: 'auto', transform: 'translate(0, -50%)' },
      'mid-center': { top: '50%', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' },
      'mid-right':  { top: '50%', right: '16px', left: 'auto', bottom: 'auto', transform: 'translate(0, -50%)' },
      'bot-left':   { bottom: '16px', left: '16px', right: 'auto', top: 'auto', transform: 'none' },
      'bot-center': { bottom: '16px', left: '50%', right: 'auto', top: 'auto', transform: 'translate(-50%, 0)' },
      'bot-right':  { bottom: '16px', right: '16px', left: 'auto', top: 'auto', transform: 'none' },
    };
    for (const position of POSITIONS) {
      const style = styleFor({ card_position: position, card_width: 500 });
      assert.deepEqual({ ...style, width: undefined, maxWidth: undefined }, { ...expected[position], width: undefined, maxWidth: undefined }, position);
      assert.equal(style.width, '500px', position);
    }
  });

  test('no edge is ever left empty: an empty edge would let the stylesheet\'s own top/left back in', () => {
    for (const position of POSITIONS) {
      const style = styleFor({ card_position: position });
      for (const edge of ['top', 'right', 'bottom', 'left']) {
        assert.ok(style[edge] !== '' && style[edge] !== undefined, `${position} ${edge}`);
      }
      // Exactly one of top/bottom and one of left/right is a real offset.
      assert.equal(['top', 'bottom'].filter((e) => style[e] !== 'auto').length, 1, `${position} vertical`);
      assert.equal(['left', 'right'].filter((e) => style[e] !== 'auto').length, 1, `${position} horizontal`);
    }
  });

  test('a dragged position is the top-left corner at that fraction of the screen, with no shift', () => {
    assert.deepEqual(styleFor({ card_custom_x: 0.25, card_custom_y: 0.1, card_width: 300, card_position: 'bot-right' }), {
      width: '300px', maxWidth: '96%', top: '10%', right: 'auto', bottom: 'auto', left: '25%', transform: 'none',
    });
  });

  test('a dragged position wins over the grid cell that was last clicked', () => {
    const dragged = styleFor({ card_position: 'bot-right', card_custom_x: 0, card_custom_y: 0 });
    assert.equal(dragged.left, '0%');
    assert.equal(dragged.top, '0%');
    assert.equal(dragged.right, 'auto');
    assert.equal(dragged.bottom, 'auto');
  });

  test('the width always comes with a ceiling, so a small canvas does not push the slot off it', () => {
    assert.equal(styleFor({ card_width: 900 }).maxWidth, '96%');
  });
});

describe('the placement module is shared by the overlay and the builder', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

  test('the OBS overlay page loads it before overlay.js, and the builder page loads it too', () => {
    const route = read('src', 'routes', 'overlay.js');
    const page = route.match(/<script src="\/overlay\/objects\/index\.js"><\/script>[\s\S]*?<script src="\/overlay\/placement\.js"><\/script>\s*<script src="\/overlay\/overlay\.js"><\/script>/);
    assert.ok(page, 'the overlay page loads placement.js between the registry and overlay.js');
    assert.match(read('src', 'views', 'overlay-builder.ejs'), /<script src="\/overlay\/placement\.js"><\/script>/);
  });

  test('exposes one global and no stray names', () => {
    assert.deepEqual(Object.keys(PLACEMENT).sort(), ['DEFAULT_WIDTH', 'MARGIN', 'MAX_WIDTH', 'MIN_WIDTH', 'placementOf', 'slotStyle']);
    const vm = require('node:vm');
    const context = vm.createContext({ window: {} });
    vm.runInContext(read('public', 'overlay', 'placement.js'), context);
    assert.deepEqual(Object.keys(context).sort(), ['window']);
    assert.deepEqual(Object.keys(context.window).sort(), ['ATLETA_PLACEMENT']);
  });

  test('the builder\'s width limits are the ones the module and the server use', () => {
    const builder = read('src', 'views', 'overlay-builder.ejs');
    assert.match(builder, /Math\.max\(200, Math\.min\(900, newWidth\)\)/);
    assert.equal(PLACEMENT.MIN_WIDTH, 200);
    assert.equal(PLACEMENT.MAX_WIDTH, 900);
    const { FIELD_SPECS } = require('../src/services/overlayDesign');
    assert.equal(FIELD_SPECS.card_width.min, PLACEMENT.MIN_WIDTH);
    assert.equal(FIELD_SPECS.card_width.max, PLACEMENT.MAX_WIDTH);
    assert.equal(PLACEMENT.DEFAULT_WIDTH, 420);
  });
});

describe('the builder shows an object where it will really sit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'overlay-builder.ejs'), 'utf8');
  const functionBody = (name) => {
    const start = builder.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} exists`);
    const next = builder.indexOf('\nfunction ', start + 1);
    return builder.slice(start, next > 0 ? next : undefined);
  };

  test('the object tabs keep Size & Position (and the resize handles); only the styling sections are hidden', () => {
    const body = functionBody('syncPhase1Controls');
    const hidden = body.match(/\[([^\]]*)\]\.forEach/)[1].match(/'([a-z-]+)'/g).map((m) => m.slice(1, -1));
    assert.deepEqual(hidden.sort(), ['section-animation', 'section-sideicon', 'section-text', 'section-theme']);
    assert.ok(!hidden.includes('section-size'), 'Size & Position stays');
    assert.ok(!body.includes('resize-se'), 'the resize handles stay');
  });

  test('the border radius row, which an object has no use for, has its own id so it can be hidden', () => {
    assert.match(builder, /id="row-border-radius"/);
    assert.match(functionBody('syncPhase1Controls'), /row-border-radius/);
  });

  test('previewing an object reads the position and width from the controls, and no longer forces top-centre', () => {
    const body = functionBody('updatePreview');
    assert.ok(!body.includes("positionCard('top-center', 420)"), 'the fixed top-centre call is gone');
    assert.doesNotMatch(body, /card_custom_x = null/, 'a dragged position is no longer blanked for objects');
    assert.match(body, /ATLETA_PLACEMENT\.placementOf\(d\)\.width/);
    assert.match(body, /positionCard\(d\.card_position, d\.card_width\)/);
  });

  test('positionCard reads the design through the shared module and measures the real size', () => {
    const body = functionBody('positionCard');
    assert.match(body, /ATLETA_PLACEMENT\.placementOf\(/);
    assert.match(body, /container\.offsetHeight/);
    assert.ok(!body.includes('140 * scale'), 'the card height is measured, not estimated');
    assert.match(body, /ATLETA_PLACEMENT\.MARGIN/);
  });

  test('resizing with the handle changes the width of an object too', () => {
    assert.match(builder, /objHost\.style\.width = newWidth \+ 'px';/);
  });

  test('a border radius of 0 is kept by the builder (the slider is not reset to 16)', () => {
    assert.match(builder, /const radius = Number\.isFinite\(d\.border_radius\) \? d\.border_radius : 16;/);
    assert.ok(!builder.includes("d.border_radius || 16"), 'no falsy fallback for the radius');
    assert.ok(!builder.includes("d.border_radius || 12"), 'no falsy fallback for the sponsor preview radius');
  });
});

describe('the legacy card stylesheet carries no position (M7)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'overlay.css'), 'utf8');
  const rule = (selector) => {
    const m = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `rule ${selector} exists`);
    return m[1];
  };
  const keyframes = (name) => {
    const m = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?\\n\\})`).exec(css);
    assert.ok(m, `@keyframes ${name} exists`);
    return m[1];
  };

  test('a card fills its slot and has no top, left or transform of its own', () => {
    const card = rule('.alert-card');
    assert.match(card, /position:\s*relative/);
    assert.match(card, /width:\s*100%/);
    for (const property of ['top', 'left', 'right', 'bottom', 'transform']) {
      assert.ok(!new RegExp(`(?:^|[\\s;])${property}\\s*:`).test(card), `no ${property} on the card`);
    }
  });

  test('no entrance keyframe carries the old baked-in -50% shift that moved a card off any position but top-centre', () => {
    for (const name of ['slideDown', 'slideUp', 'slideLeft', 'slideRight', 'zoomIn', 'fadeIn', 'slideOutUp']) {
      assert.ok(!keyframes(name).includes('-50%'), name);
    }
  });

  test('every entrance the builder offers ends where it started from (no offset left at the end)', () => {
    for (const name of ['slideDown', 'slideUp', 'slideLeft', 'slideRight', 'zoomIn']) {
      const to = /to\s*\{([^}]*)\}/.exec(keyframes(name))[1];
      assert.match(to, /transform:\s*(?:translate[XY]\(0\)|scale\(1\))/, name);
      assert.match(to, /opacity:\s*1/, name);
    }
  });

  test('Slide Up moves in from below (it used to be an exit, and left the card invisible)', () => {
    const body = keyframes('slideUp');
    assert.match(/from\s*\{([^}]*)\}/.exec(body)[1], /translateY\(120%\)/);
    assert.match(/to\s*\{([^}]*)\}/.exec(body)[1], /translateY\(0\)/);
    assert.match(rule('.alert-card.dismissing'), /animation:\s*slideOutUp/, 'the exit has its own name');
  });

  test('the entrances the builder offers are the ones the stylesheet defines', () => {
    const { FIELD_SPECS } = require('../src/services/overlayDesign');
    for (const name of FIELD_SPECS.entrance_animation.values) assert.ok(keyframes(name), name);
  });
});
