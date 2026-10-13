'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  BUILDER_EVENT_TYPES, OVERLAY_FONTS, FIELD_SPECS, ICON_MAX_CHARACTERS, isBuilderEventType, validateOverlayDesign,
} = require('./overlayDesign');

const root = path.join(__dirname, '..', '..');
const builder = fs.readFileSync(path.join(root, 'src', 'views', 'overlay-builder.ejs'), 'utf8');
const overlayJs = fs.readFileSync(path.join(root, 'public', 'overlay', 'overlay.js'), 'utf8');

// What the builder's getControlValues() sends for a design: the controls' values
// (here: the event's defaults) plus the sponsor animation and the advanced theme.
function builderPayload(over = {}) {
  return {
    bg_color: '#1a1a3e', accent_color: '#8888cc', border_color: '#8888cc', text_color: '#ffffff',
    font_family: 'System Default', username_size: 24, event_label: 'New Pit Crew Member', detail_text: 'just joined the race',
    entrance_animation: 'slideDown', car_animation: 'zoomLR', screen_effect: 'default', animation_speed: 1,
    card_width: 420, card_position: 'top-center', card_custom_x: null, card_custom_y: null, border_radius: 16,
    sponsor_animation: 'fade',
    label_font_family: null, label_font_size: 10, label_font_weight: 700, label_color: null,
    username_font_family: null, username_font_weight: 800, username_color: null,
    detail_font_family: null, detail_font_size: 13, detail_font_weight: 400, detail_color: null,
    text_align: 'center', card_side_icon: null, effect_amount: 1, effect_size: 1, effect_direction: 'down',
    bg_opacity: 1, gradient_direction: '160deg', border_thickness: 2, border_opacity: 0.5,
    glow_intensity: 0.25, shadow_opacity: 0.6, shadow_blur: 32, shadow_spread: 0,
    ...over,
  };
}

const rejects = (over, field) => assert.deepEqual(validateOverlayDesign(builderPayload(over)), { ok: false, field }, JSON.stringify(over));
const accepts = (over) => {
  const result = validateOverlayDesign(builderPayload(over));
  assert.equal(result.ok, true, `${JSON.stringify(over)} -> ${JSON.stringify(result)}`);
  return result.design;
};

describe('event types', () => {
  test('are the builder\'s tabs', () => {
    const tabs = [...builder.matchAll(/class="event-tab[^"]*" data-type="([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(tabs.length >= 10, 'found the tabs');
    assert.deepEqual([...BUILDER_EVENT_TYPES].sort(), [...tabs].sort());
  });

  test('anything else is refused', () => {
    for (const bad of ['', 'FOLLOW', 'follow ', 'chat', '__proto__', 'constructor', 'x'.repeat(1000), undefined, null, 5, ['follow'], { toString: () => 'follow' }]) {
      assert.equal(isBuilderEventType(bad), false, String(bad));
    }
    for (const good of BUILDER_EVENT_TYPES) assert.equal(isBuilderEventType(good), true, good);
  });
});

describe('a design the builder sends', () => {
  test('is accepted as it is, with every field kept', () => {
    const payload = builderPayload();
    const result = validateOverlayDesign(payload);
    assert.equal(result.ok, true);
    const { card_custom_x, card_custom_y, label_font_family, label_color, username_font_family, username_color, detail_font_family, detail_color, card_side_icon, ...kept } = payload;
    assert.deepEqual(result.design, kept, 'null fields are left out, so the database defaults apply');
  });

  test('every event\'s default design in the builder is accepted', () => {
    const start = builder.indexOf('const TEXT_STYLE_DEFAULTS');
    const end = builder.indexOf('const EVENT_NAMES');
    assert.ok(start > 0 && end > start, 'found the defaults in the builder');
    const { EVENT_DEFAULTS, DEFAULT_SIDE_ICONS } = vm.runInNewContext(`${builder.slice(start, end)}; ({ EVENT_DEFAULTS, DEFAULT_SIDE_ICONS })`);
    assert.deepEqual(Object.keys(EVENT_DEFAULTS).sort(), [...BUILDER_EVENT_TYPES].sort());
    for (const [type, defaults] of Object.entries(EVENT_DEFAULTS)) {
      const result = validateOverlayDesign({ ...defaults, sponsor_animation: 'fade', card_custom_x: null, card_custom_y: null });
      assert.equal(result.ok, true, `${type}: ${JSON.stringify(result)}`);
    }
    for (const [type, icon] of Object.entries(DEFAULT_SIDE_ICONS)) {
      assert.equal(validateOverlayDesign(builderPayload({ card_side_icon: icon })).ok, true, `${type} default side icon`);
    }
  });

  test('a design saved as JSON text is read too', () => {
    const result = validateOverlayDesign(JSON.stringify(builderPayload({ bg_color: '#112233' })));
    assert.equal(result.ok, true);
    assert.equal(result.design.bg_color, '#112233');
  });

  test('fields it does not know are dropped, not saved', () => {
    const design = accepts({ streamer_id: 999, id: 1, created_at: 'x', __proto__: { polluted: true }, constructor: 'x', extra: '<script>' });
    for (const key of ['streamer_id', 'id', 'created_at', 'extra', 'polluted']) assert.equal(key in design, false, key);
    assert.equal(Object.getPrototypeOf(design), Object.prototype);
    assert.equal({}.polluted, undefined);
  });

  test('a design that is not an object is refused', () => {
    for (const bad of [undefined, null, 5, true, [], [builderPayload()], 'not json', '{"bg_color":', '[]', '5', 'null']) {
      assert.deepEqual(validateOverlayDesign(bad), { ok: false, field: 'design' }, String(bad));
    }
  });

  test('missing fields are fine (the database fills in defaults)', () => {
    assert.deepEqual(validateOverlayDesign({}), { ok: true, design: {} });
    assert.deepEqual(validateOverlayDesign({ bg_color: '#000000' }), { ok: true, design: { bg_color: '#000000' } });
  });
});

describe('colours', () => {
  const colourFields = ['bg_color', 'accent_color', 'border_color', 'text_color', 'label_color', 'username_color', 'detail_color'];

  test('are #rrggbb', () => {
    for (const field of colourFields) {
      accepts({ [field]: '#00ff7f' });
      accepts({ [field]: '#ABCDEF' });
    }
  });

  test('anything else is refused', () => {
    for (const field of colourFields) {
      for (const bad of ['#fff', '#12345', '#1234567', '#gggggg', 'red', 'rgb(0,0,0)', 'url(javascript:alert(1))', '00ff7f', '#00ff7f;x', '#00ff7f"', 7, true, {}, []]) {
        rejects({ [field]: bad }, field);
      }
    }
  });

  test('an empty colour means "not set"', () => {
    for (const field of colourFields) assert.equal(field in accepts({ [field]: '' }), false);
    for (const field of colourFields) assert.equal(field in accepts({ [field]: null }), false);
  });
});

describe('numbers match the builder\'s controls', () => {
  // [field, min, max] as the builder's sliders and its drag/resize allow them.
  const ranges = [
    ['username_size', 14, 52], ['card_width', 200, 900], ['border_radius', 0, 32],
    ['label_font_size', 8, 24], ['detail_font_size', 8, 32],
    ['animation_speed', 0.5, 2], ['effect_amount', 0.2, 3], ['effect_size', 0.5, 3],
    ['bg_opacity', 0, 1], ['border_opacity', 0, 1], ['glow_intensity', 0, 1], ['shadow_opacity', 0, 1],
    ['border_thickness', 0, 6], ['shadow_blur', 0, 80], ['shadow_spread', -20, 20],
    ['card_custom_x', 0, 1], ['card_custom_y', 0, 1],
  ];

  test('the bounds themselves are kept, and anything beyond them is moved to the nearest bound', () => {
    for (const [field, min, max] of ranges) {
      const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.01;
      assert.equal(accepts({ [field]: min })[field], min, `${field} min`);
      assert.equal(accepts({ [field]: max })[field], max, `${field} max`);
      assert.equal(accepts({ [field]: min - step })[field], min, `${field} just under`);
      assert.equal(accepts({ [field]: max + step })[field], max, `${field} just over`);
      assert.equal(accepts({ [field]: 1e9 })[field], max, `${field} far over`);
      assert.equal(accepts({ [field]: -1e9 })[field], min, `${field} far under`);
    }
  });

  test('every number the server holds is covered by a range here', () => {
    const numeric = Object.entries(FIELD_SPECS).filter(([, s]) => s.kind === 'int' || s.kind === 'number').map(([f]) => f);
    assert.deepEqual(numeric.sort(), ranges.map(([f]) => f).sort());
    for (const [field, min, max] of ranges) {
      assert.equal(FIELD_SPECS[field].min, min, `${field} min`);
      assert.equal(FIELD_SPECS[field].max, max, `${field} max`);
    }
  });

  test('a whole-number field rounds a fraction', () => {
    for (const field of ['username_size', 'card_width', 'border_radius', 'border_thickness', 'shadow_blur', 'shadow_spread', 'label_font_size', 'detail_font_size']) {
      const { min, max } = FIELD_SPECS[field];
      assert.equal(accepts({ [field]: min + 0.4 })[field], min, `${field} rounds down`);
      assert.equal(accepts({ [field]: min + 0.6 })[field], min + 1, `${field} rounds up`);
      assert.equal(accepts({ [field]: max - 0.4 })[field], max, `${field} near its top`);
    }
    assert.ok(Object.is(accepts({ shadow_spread: -0.4 }).shadow_spread, 0), 'never -0');
  });

  test('text, a boolean, a list, an object and NaN are not numbers', () => {
    for (const field of ['username_size', 'animation_speed', 'bg_opacity', 'card_custom_x']) {
      for (const bad of ['24', '1e3', 'abc', NaN, true, [], {}]) rejects({ [field]: bad }, field);
    }
  });

  test('a number too big for JSON to hold (1e999 reads as Infinity) is moved to the bound', () => {
    const { design } = validateOverlayDesign('{"username_size":1e999,"shadow_spread":-1e999,"bg_opacity":1e999}');
    assert.deepEqual([design.username_size, design.shadow_spread, design.bg_opacity], [52, -20, 1]);
    for (const field of ['username_size', 'animation_speed']) {
      assert.equal(accepts({ [field]: Infinity })[field], FIELD_SPECS[field].max, `${field} +Infinity`);
      assert.equal(accepts({ [field]: -Infinity })[field], FIELD_SPECS[field].min, `${field} -Infinity`);
    }
  });

  test('a null number is left out (the database default applies), and the free-drag position can be cleared', () => {
    const design = accepts({ username_size: null, card_custom_x: null, card_custom_y: null, border_radius: undefined });
    for (const field of ['username_size', 'card_custom_x', 'card_custom_y', 'border_radius']) assert.equal(field in design, false, field);
  });

  test('every slider and drag range in the builder fits inside the server range', () => {
    const slider = (id) => {
      const m = builder.match(new RegExp(`<input[^>]*type="range"[^>]*id="${id}"[^>]*>`)) || builder.match(new RegExp(`<input[^>]*id="${id}"[^>]*type="range"[^>]*>`));
      assert.ok(m, `found slider ${id}`);
      return { min: Number(/min="([^"]+)"/.exec(m[0])[1]), max: Number(/max="([^"]+)"/.exec(m[0])[1]) };
    };
    const controls = {
      username_size: ['ctrl-username-size', 'modal-username-size'], card_width: ['ctrl-card-width'], border_radius: ['ctrl-border-radius'],
      label_font_size: ['modal-label-size'], detail_font_size: ['modal-detail-size'],
      animation_speed: ['ctrl-animation-speed', 'modal-animation-speed'], effect_amount: ['ctrl-effect-amount', 'modal-effect-amount'],
      effect_size: ['ctrl-effect-size', 'modal-effect-size'], bg_opacity: ['modal-bg-opacity'], border_opacity: ['modal-border-opacity'],
      glow_intensity: ['modal-glow-intensity'], shadow_opacity: ['modal-shadow-opacity'], border_thickness: ['modal-border-thickness'],
      shadow_blur: ['modal-shadow-blur'], shadow_spread: ['modal-shadow-spread'],
    };
    for (const [field, ids] of Object.entries(controls)) {
      for (const id of ids) {
        const { min, max } = slider(id);
        assert.ok(FIELD_SPECS[field].min <= min && FIELD_SPECS[field].max >= max, `${field}: ${id} runs ${min}-${max}, the server allows ${FIELD_SPECS[field].min}-${FIELD_SPECS[field].max}`);
      }
    }
    // Resizing the card by dragging clamps to 200-900 (see the mousemove handler).
    assert.match(builder, /Math\.max\(200, Math\.min\(900, newWidth\)\)/);
  });
});

describe('fonts', () => {
  const fontFields = ['font_family', 'label_font_family', 'username_font_family', 'detail_font_family'];

  test('are the ones the OBS overlay can load, and the builder\'s picker offers exactly those', () => {
    const fontMap = overlayJs.match(/const FONT_MAP = \{([\s\S]*?)\};/)[1];
    const overlayFonts = [...fontMap.matchAll(/'([^']+)':/g)].map((m) => m[1]);
    const picker = builder.match(/const FONT_LIST = \[([\s\S]*?)\];/)[1];
    const pickerFonts = [...picker.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
    const sorted = (list) => [...list].sort();
    assert.deepEqual(sorted(OVERLAY_FONTS), sorted(['System Default', ...overlayFonts]));
    assert.deepEqual(sorted(OVERLAY_FONTS), sorted(pickerFonts));
  });

  test('each is accepted', () => {
    for (const field of fontFields) for (const name of OVERLAY_FONTS) assert.equal(accepts({ [field]: name })[field], name);
  });

  test('another name is replaced by the default (left out), whatever it contains, so it never reaches a stylesheet', () => {
    for (const field of fontFields) {
      for (const other of ['Comic Sans MS', 'inter', 'Inter, sans-serif', "Arial'; color: red", '</style><script>', 'url(x)', 'a'.repeat(5000), 'Orbitron']) {
        assert.equal(field in accepts({ [field]: other }), false, `${field}=${other.slice(0, 20)}`);
      }
    }
  });

  test('something that is not a name at all is refused', () => {
    for (const field of fontFields) for (const bad of [5, true, [], {}]) rejects({ [field]: bad }, field);
  });

  test('the per-text fonts may be null (inherit); the main font is just left out', () => {
    for (const field of fontFields) assert.equal(field in accepts({ [field]: null }), false);
  });
});

describe('drop-down choices', () => {
  const optionsOf = (id) => {
    const select = builder.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(select, `found select ${id}`);
    return [...select[1].matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);
  };
  const same = (a, b) => assert.deepEqual([...a].map(String).sort(), [...b].map(String).sort());

  test('match the options the builder offers', () => {
    for (const id of ['ctrl-entrance-animation', 'modal-entrance-animation']) same(FIELD_SPECS.entrance_animation.values, optionsOf(id));
    for (const id of ['ctrl-car-animation', 'modal-car-animation']) same(FIELD_SPECS.car_animation.values, optionsOf(id));
    for (const id of ['ctrl-screen-effect', 'modal-screen-effect']) same(FIELD_SPECS.screen_effect.values, optionsOf(id));
    for (const id of ['ctrl-effect-direction', 'modal-effect-direction']) same(FIELD_SPECS.effect_direction.values, optionsOf(id));
    same(FIELD_SPECS.sponsor_animation.values, optionsOf('ctrl-sponsor-animation'));
    same(FIELD_SPECS.gradient_direction.values, optionsOf('modal-gradient-direction'));
    for (const id of ['modal-label-weight', 'modal-username-weight', 'modal-detail-weight']) same(FIELD_SPECS.label_font_weight.values, optionsOf(id));
  });

  test('the position grid and the text alignment buttons match too', () => {
    const cells = [...builder.matchAll(/class="pos-cell[^"]*" data-pos="([a-z-]+)"/g)].map((m) => m[1]);
    same(FIELD_SPECS.card_position.values, cells);
    const aligns = [...builder.matchAll(/class="text-align-btn[^"]*" data-align="([a-z]+)"/g)].map((m) => m[1]);
    same(FIELD_SPECS.text_align.values, aligns);
  });

  const choiceFields = ['entrance_animation', 'car_animation', 'screen_effect', 'effect_direction', 'sponsor_animation', 'card_position', 'text_align', 'gradient_direction', 'label_font_weight', 'username_font_weight', 'detail_font_weight'];
  const isNumeric = (field) => typeof FIELD_SPECS[field].values[0] === 'number'; // the font weights

  test('each choice is accepted', () => {
    for (const field of choiceFields) {
      for (const value of FIELD_SPECS[field].values) {
        const design = accepts({ [field]: value });
        if (value === '' && field !== 'gradient_direction') assert.equal(field in design, false);
        else assert.equal(design[field], value, `${field}=${value}`);
      }
    }
  });

  test('another choice is replaced by the default (left out), never saved', () => {
    for (const field of choiceFields) {
      const others = isNumeric(field) ? [0, 399, 650, 900, -1] : ['nope', 'SlideDown', 'x'.repeat(500), '<b>', 'bounce', 'goldRain'];
      for (const other of others) assert.equal(field in accepts({ [field]: other }), false, `${field}=${String(other).slice(0, 20)}`);
    }
  });

  test('a choice of the wrong kind (a number for a name, a name for a font weight, a boolean, a list) is refused', () => {
    for (const field of choiceFields) {
      const wrong = isNumeric(field) ? ['700', 'bold', true, [], {}] : [999, true, [], {}];
      for (const bad of wrong) rejects({ [field]: bad }, field);
    }
  });

  test('the "solid" gradient (an empty direction) is a real choice, not "not set"', () => {
    assert.equal(accepts({ gradient_direction: '' }).gradient_direction, '');
    assert.equal('entrance_animation' in accepts({ entrance_animation: '' }), false, 'but an empty animation is not set');
  });
});

describe('text', () => {
  test('the label is kept up to 100 characters and the detail up to 300, and cut after that', () => {
    assert.equal(accepts({ event_label: 'x'.repeat(100) }).event_label, 'x'.repeat(100));
    assert.equal(accepts({ event_label: 'x'.repeat(101) }).event_label, 'x'.repeat(100));
    assert.equal(accepts({ event_label: 'x'.repeat(5000) }).event_label.length, 100);
    assert.equal(accepts({ detail_text: 'x'.repeat(300) }).detail_text, 'x'.repeat(300));
    assert.equal(accepts({ detail_text: 'x'.repeat(301) }).detail_text, 'x'.repeat(300));
  });

  test('text is cut by characters, so an emoji is never split in half', () => {
    const flag = '\u{1F3C1}';
    const cut = accepts({ event_label: flag.repeat(101) }).event_label;
    assert.equal(cut, flag.repeat(100));
    assert.ok(Array.from(cut).every((c) => c === flag));
  });

  test('an empty text is what the streamer typed, and is kept', () => {
    const design = accepts({ event_label: '', detail_text: '' });
    assert.equal(design.event_label, '');
    assert.equal(design.detail_text, '');
  });

  test('must be text', () => {
    for (const field of ['event_label', 'detail_text']) for (const bad of [5, true, ['a'], { a: 1 }]) rejects({ [field]: bad }, field);
  });

  test('emoji and markup characters are kept as typed (the pages escape them when they show them)', () => {
    assert.equal(accepts({ detail_text: 'just joined the race \u{1F3C1} <3 & "friends"' }).detail_text, 'just joined the race \u{1F3C1} <3 & "friends"');
  });
});

describe('side icon', () => {
  test('is "none" or an emoji from the builder\'s grid', () => {
    const icons = [...builder.matchAll(/class="side-icon-btn" data-icon="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(icons.length >= 12, 'found the grid');
    for (const icon of icons) assert.equal(accepts({ card_side_icon: icon }).card_side_icon, icon, icon);
  });

  test('up to 8 characters is kept; anything longer is not an icon, so the default icon applies', () => {
    assert.equal(ICON_MAX_CHARACTERS, 8);
    assert.equal(accepts({ card_side_icon: '\u{1F3C6}'.repeat(8) }).card_side_icon, '\u{1F3C6}'.repeat(8));
    assert.equal('card_side_icon' in accepts({ card_side_icon: '\u{1F3C6}'.repeat(9) }), false);
    assert.equal('card_side_icon' in accepts({ card_side_icon: 'abcdefghi' }), false);
  });

  test('markup, quotes and control characters never get through: the icon is dropped', () => {
    for (const bad of ['<b>', '<img src=x onerror=alert(1)>', '"', "'", '&amp;', '`', 'a\nb', 'a\u0000', '</p>']) {
      assert.equal('card_side_icon' in accepts({ card_side_icon: bad }), false, JSON.stringify(bad));
    }
  });

  test('is left out when null or empty (the event\'s default icon applies)', () => {
    assert.equal('card_side_icon' in accepts({ card_side_icon: null }), false);
    assert.equal('card_side_icon' in accepts({ card_side_icon: '' }), false);
    for (const bad of [5, true, ['x'], {}]) rejects({ card_side_icon: bad }, 'card_side_icon');
  });
});

// ── Compatibility with designs saved by older builders ───────────────────

describe('a design saved by an older builder', () => {
  // The first builder (commit 9e01c54) offered these names, since renamed or removed:
  // the car animation "bounce" and the screen effects "goldRain", "moneyRain", "tireMarks".
  const retired = [['car_animation', 'bounce'], ['screen_effect', 'goldRain'], ['screen_effect', 'moneyRain'], ['screen_effect', 'tireMarks']];

  // What the builder posts back for an alert whose saved design holds values it no longer offers.
  const oldStyle = () => builderPayload({
    username_size: 64, // past the slider's 52
    font_family: 'Orbitron', // not in the picker
    car_animation: 'bounce',
    screen_effect: 'goldRain',
    label_font_family: 'Orbitron',
    label_font_size: 40,
    card_width: 1400,
    card_custom_x: -0.2,
    card_custom_y: 1.4,
    border_radius: 18.5,
    event_label: 'x'.repeat(130),
  });

  test('is saved normalised, not refused: numbers into range, unknown fonts and choices replaced by the default', () => {
    const result = validateOverlayDesign(oldStyle());
    assert.equal(result.ok, true, JSON.stringify(result));
    const d = result.design;
    assert.equal(d.username_size, 52);
    assert.equal(d.label_font_size, 24);
    assert.equal(d.card_width, 900);
    assert.equal(d.card_custom_x, 0);
    assert.equal(d.card_custom_y, 1);
    assert.equal(d.border_radius, 19);
    assert.equal(d.event_label, 'x'.repeat(100));
    for (const field of ['font_family', 'label_font_family', 'car_animation', 'screen_effect']) assert.equal(field in d, false, `${field} falls back to the default`);
  });

  test('keeps everything else as it was sent', () => {
    const sent = oldStyle();
    const d = validateOverlayDesign(sent).design;
    for (const field of ['bg_color', 'accent_color', 'text_color', 'entrance_animation', 'card_position', 'detail_text', 'bg_opacity', 'gradient_direction', 'shadow_blur']) {
      assert.equal(d[field], sent[field], field);
    }
  });

  test('is the same when it comes as JSON text', () => {
    assert.deepEqual(validateOverlayDesign(JSON.stringify(oldStyle())), validateOverlayDesign(oldStyle()));
  });

  test('the names the first builder offered are replaced by the default', () => {
    for (const [field, name] of retired) assert.equal(field in accepts({ [field]: name }), false, `${field}=${name}`);
  });

  test('saving what came out again changes nothing more', () => {
    const once = validateOverlayDesign(oldStyle()).design;
    assert.deepEqual(validateOverlayDesign(once), { ok: true, design: once });
  });
});

describe('a design no builder could have sent is still refused', () => {
  test('a value of the wrong kind names its field', () => {
    const wrong = [
      ['username_size', '24'], ['card_width', true], ['border_radius', {}], ['animation_speed', []], ['bg_opacity', NaN],
      ['font_family', 5], ['entrance_animation', 5], ['label_font_weight', '700'], ['event_label', 5], ['detail_text', ['x']], ['card_side_icon', 5],
    ];
    for (const [field, bad] of wrong) rejects({ [field]: bad }, field);
  });

  test('a colour that is not #rrggbb names its field', () => {
    for (const bad of ['red', '#fff', 'rgb(0,0,0)', 'url(javascript:alert(1))', '#12345', '#00ff7f;x', 7]) rejects({ text_color: bad }, 'text_color');
  });

  test('one bad value refuses the whole design, even next to values that only needed adjusting', () => {
    assert.deepEqual(validateOverlayDesign(builderPayload({ username_size: 64, font_family: 'Orbitron', text_color: 'red' })), { ok: false, field: 'text_color' });
  });

  test('so does a design that is not an object', () => {
    for (const bad of [undefined, null, 5, true, [], 'not json', '{"bg_color":', '[]']) {
      assert.deepEqual(validateOverlayDesign(bad), { ok: false, field: 'design' }, String(bad));
    }
  });
});
