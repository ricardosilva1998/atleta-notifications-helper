'use strict';

// What the overlay builder may save, and how a design is cleaned up on the way in.
// The builder (src/views/overlay-builder.ejs) only ever produces the values below:
// the event types of its tabs, #rrggbb colours, the ranges of its controls, the
// fonts of its picker (the ones the OBS overlay can load), and the option lists
// of its drop-downs. src/services/overlayDesign.test.js reads the builder and
// the overlay and fails when they drift apart from this file.
//
// A design saved by an older builder, or one the builder posts back from its saved
// state, can still carry a value outside those lists (an animation that has since
// been renamed, a number past a range). Refusing the whole design for that would
// leave the streamer unable to save anything for the alert, so a value that is of
// the right kind but not allowed is brought into what is allowed:
//   - a number past its range is moved to the nearest end of the range (a
//     whole-number field is rounded first), and text that is too long is cut
//   - a font, a choice or an icon that is not one of the known ones is replaced by
//     the default: it is left out of the design, so the database default applies
// Only a design that cannot have come from a builder is refused, and the result
// then names the field: not an object, a value of the wrong kind (text where a
// number goes), or a colour that is not #rrggbb.

const BUILDER_EVENT_TYPES = Object.freeze([
  'follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner',
  'yt_superchat', 'yt_member', 'yt_giftmember', 'timed',
]);

// 'System Default' plus FONT_MAP in public/overlay/overlay.js.
const OVERLAY_FONTS = Object.freeze([
  'System Default', 'Outfit', 'Inter', 'Poppins', 'Roboto Mono', 'Press Start 2P', 'Permanent Marker', 'Bangers',
]);

const POSITIONS = [
  'top-left', 'top-center', 'top-right', 'mid-left', 'mid-center', 'mid-right', 'bot-left', 'bot-center', 'bot-right',
];

// The design each alert starts from in the builder before anything is saved for it.
// This is the one copy: the builder page is handed this table (routes/dashboard.js),
// and a value that has to be replaced on save falls back to the entry for its own
// event (so a raid's missing animation becomes the raid's "none", not a global one).
const TEXT_STYLE_DEFAULTS = Object.freeze({
  label_font_family: null, label_font_size: 10, label_font_weight: 700, label_color: null,
  username_font_family: null, username_font_weight: 800, username_color: null,
  detail_font_family: null, detail_font_size: 13, detail_font_weight: 400, detail_color: null,
  text_align: 'center', card_side_icon: null, effect_amount: 1.0, effect_size: 1.0, effect_direction: 'down',
});

const SHARED_DEFAULTS = Object.freeze({
  text_color: '#ffffff', font_family: 'System Default', username_size: 24, entrance_animation: 'slideDown',
  car_animation: 'zoomLR', screen_effect: 'default', animation_speed: 1.0,
  card_width: 420, card_position: 'top-center', border_radius: 16,
});

function eventDefaults(colour, accent, event_label, detail_text, over = {}) {
  return Object.freeze({
    ...TEXT_STYLE_DEFAULTS, ...SHARED_DEFAULTS,
    bg_color: colour, accent_color: accent, border_color: accent, event_label, detail_text, ...over,
  });
}

const EVENT_DEFAULTS = Object.freeze({
  follow: eventDefaults('#1a1a3e', '#8888cc', 'New Pit Crew Member', 'just joined the race 🏁'),
  subscription: eventDefaults('#061a10', '#00ff88', 'Podium Finish', ''),
  bits: eventDefaults('#1c1200', '#f7c948', 'Nitro Boost', ''),
  donation: eventDefaults('#110022', '#bf00ff', 'Sponsor Alert', ''),
  raid: eventDefaults('#1c0505', '#ff4444', 'Incoming Raid', '', { car_animation: 'none' }),
  yt_superchat: eventDefaults('#200808', '#ff4444', 'Super Chat', ''),
  yt_member: eventDefaults('#041a0c', '#0f9d58', 'New Member', '', { car_animation: 'none' }),
  yt_giftmember: eventDefaults('#060e20', '#4285f4', 'Gift Alert', ''),
  timed: eventDefaults('#1a1a2e', '#f79009', '', '', {
    username_size: 18, car_animation: 'none', screen_effect: 'none', card_width: 500, card_position: 'bot-center', border_radius: 12,
  }),
  giveaway_winner: eventDefaults('#1c1200', '#f59e0b', 'Giveaway Winner!', ''),
});

const hex = { kind: 'hex' };
const hexOrNull = { kind: 'hex', nullable: true };
const font = { kind: 'font' };
const fontOrNull = { kind: 'font', nullable: true };
const weight = { kind: 'enum', values: [400, 500, 600, 700, 800] };

// Every field the builder sends. `kind`: hex | font | text | enum | int | number | icon.
const FIELD_SPECS = Object.freeze({
  bg_color: hex,
  accent_color: hex,
  border_color: hex,
  text_color: hex,
  font_family: font,
  username_size: { kind: 'int', min: 14, max: 52 },
  event_label: { kind: 'text', max: 100 },
  detail_text: { kind: 'text', max: 300 },
  entrance_animation: { kind: 'enum', values: ['slideDown', 'slideUp', 'slideLeft', 'slideRight', 'zoomIn', 'fadeIn'] },
  car_animation: { kind: 'enum', values: ['zoomLR', 'zoomRL', 'checkered', 'flames', 'sparkles', 'lightning', 'neonSweep', 'equalizer', 'pulse', 'none'] },
  screen_effect: { kind: 'enum', values: ['default', 'none', 'confetti', 'gold', 'money', 'robots', 'tiremarks'] },
  animation_speed: { kind: 'number', min: 0.5, max: 2 },
  // The width slider runs 280-700; dragging the card's resize handle allows 200-900.
  card_width: { kind: 'int', min: 200, max: 900 },
  card_position: { kind: 'enum', values: POSITIONS },
  // Where the card was dragged to, as a fraction of the screen.
  card_custom_x: { kind: 'number', min: 0, max: 1, nullable: true },
  card_custom_y: { kind: 'number', min: 0, max: 1, nullable: true },
  border_radius: { kind: 'int', min: 0, max: 32 },
  sponsor_animation: { kind: 'enum', values: ['fade', 'slide-left', 'slide-right', 'slide-up', 'drop-down', 'zoom', 'none'] },
  label_font_family: fontOrNull,
  label_font_size: { kind: 'int', min: 8, max: 24 },
  label_font_weight: weight,
  label_color: hexOrNull,
  username_font_family: fontOrNull,
  username_font_weight: weight,
  username_color: hexOrNull,
  detail_font_family: fontOrNull,
  detail_font_size: { kind: 'int', min: 8, max: 32 },
  detail_font_weight: weight,
  detail_color: hexOrNull,
  text_align: { kind: 'enum', values: ['left', 'center', 'right'] },
  card_side_icon: { kind: 'icon', nullable: true },
  effect_amount: { kind: 'number', min: 0.2, max: 3 },
  effect_size: { kind: 'number', min: 0.5, max: 3 },
  effect_direction: { kind: 'enum', values: ['down', 'up', 'left', 'right'] },
  bg_opacity: { kind: 'number', min: 0, max: 1 },
  // 'solid' is the "Solid (no gradient)" choice: a real value, so nothing that treats an
  // empty value as "not set" (a `||` fallback, the database default) can lose it.
  gradient_direction: { kind: 'enum', values: ['160deg', '180deg', '0deg', '90deg', '270deg', '135deg', '45deg', 'solid'] },
  border_thickness: { kind: 'int', min: 0, max: 6 },
  border_opacity: { kind: 'number', min: 0, max: 1 },
  glow_intensity: { kind: 'number', min: 0, max: 1 },
  shadow_opacity: { kind: 'number', min: 0, max: 1 },
  shadow_blur: { kind: 'int', min: 0, max: 80 },
  shadow_spread: { kind: 'int', min: -20, max: 20 },
});

const ICON_MAX_CHARACTERS = 8;
// Never part of an icon, and the characters that would matter if one were put into markup.
const ICON_FORBIDDEN = /[<>&"'`\u0000-\u001F\u007F]/;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function isBuilderEventType(value) {
  return typeof value === 'string' && BUILDER_EVENT_TYPES.includes(value);
}

// What becomes of one value that was sent: { value } to save (as it was, or brought
// into what is allowed), { unset: true } to leave it out so the database default
// applies, or { invalid: true } when it cannot have come from a builder.
const UNSET = Object.freeze({ unset: true });
const INVALID = Object.freeze({ invalid: true });

function normalise(spec, value) {
  if (typeof value === 'number' && Number.isNaN(value)) return INVALID;
  switch (spec.kind) {
    case 'hex':
      return typeof value === 'string' && HEX_COLOUR.test(value) ? { value } : INVALID;
    case 'font':
      if (typeof value !== 'string') return INVALID;
      return OVERLAY_FONTS.includes(value) ? { value } : UNSET;
    case 'text': {
      if (typeof value !== 'string') return INVALID;
      // Cut by characters, not UTF-16 units, so an emoji is never split in two.
      const characters = Array.from(value);
      return { value: characters.length <= spec.max ? value : characters.slice(0, spec.max).join('') };
    }
    case 'enum':
      // The choices are all text, or all numbers (font weights): the other kind is a wrong kind.
      if (typeof value !== typeof spec.values[0]) return INVALID;
      return spec.values.includes(value) ? { value } : UNSET;
    case 'int':
    case 'number': {
      if (typeof value !== 'number') return INVALID;
      const wanted = spec.kind === 'int' ? Math.round(value) : value;
      const inRange = Math.min(spec.max, Math.max(spec.min, wanted));
      return { value: inRange === 0 ? 0 : inRange }; // never -0
    }
    case 'icon':
      if (typeof value !== 'string') return INVALID;
      return Array.from(value).length <= ICON_MAX_CHARACTERS && !ICON_FORBIDDEN.test(value) ? { value } : UNSET;
    default:
      return INVALID;
  }
}

// An empty hex, font or enum choice means "not set": the database default
// applies. Text is different: an empty label is what the streamer typed.
function isUnset(spec, value) {
  if (value === undefined || value === null) return true;
  return value === '' && spec.kind !== 'text';
}

// What a value that is replaced becomes: the entry of its own event in
// EVENT_DEFAULTS, or nothing (left out, so the database default applies) when the
// event is not known or its default is "not set" (null).
function eventFallback(eventType, field) {
  if (typeof eventType !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_DEFAULTS, eventType)) return undefined;
  const value = EVENT_DEFAULTS[eventType][field];
  return value === null ? undefined : value;
}

// The design the builder posted (an object, or JSON text of one) for `eventType`:
// { ok: true, design } with only the known fields, each brought into what is allowed
// (see the top of this file), or { ok: false, field } naming the first value that
// cannot have come from a builder. Fields left out, null or empty are left out of
// the result, so the database defaults apply. A value that is replaced (a font, a
// choice or an icon that is not allowed) becomes the default of its own event, or is
// left out when there is none or no event type was given.
function validateOverlayDesign(input, eventType) {
  let source = input;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { return { ok: false, field: 'design' }; }
  }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return { ok: false, field: 'design' };

  const design = {};
  for (const [field, spec] of Object.entries(FIELD_SPECS)) {
    const value = Object.prototype.hasOwnProperty.call(source, field) ? source[field] : undefined;
    if (isUnset(spec, value)) continue;
    const result = normalise(spec, value);
    if (result.invalid) return { ok: false, field };
    if (!result.unset) design[field] = result.value;
    else {
      const fallback = eventFallback(eventType, field);
      if (fallback !== undefined) design[field] = fallback;
    }
  }
  return { ok: true, design };
}

module.exports = {
  BUILDER_EVENT_TYPES,
  OVERLAY_FONTS,
  EVENT_DEFAULTS,
  FIELD_SPECS,
  ICON_MAX_CHARACTERS,
  isBuilderEventType,
  validateOverlayDesign,
};
