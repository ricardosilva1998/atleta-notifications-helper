'use strict';

/**
 * The alert kit: what every look shares (docs/superpowers/specs/2026-10-15-alert-styles-design.md).
 * Loaded after objects/index.js and before the family files (objects/styles/*.js, served joined as
 * /overlay/objects/styles.js) by the OBS overlay and by the Overlay Builder alike:
 *   - the helpers a look's render(d) uses: escaping, names that fit, odometer digits, typed text
 *   - registerFamily() and register(): a look joins the style map index.js starts
 *     (window.ATLETA_OBJECT_STYLES), next to andre_vilela_'s C1
 *   - lookData() and slotVars(): what a look is handed from the alert's saved design, for the
 *     overlay and the builder preview alike (one function, so the two draw the same thing)
 *   - accentVars(): the colour variables a slot carries when the streamer picked a colour
 *   - sizeOf(): the number a picture grows with ("grows with the amount" off: a middle value)
 *   - the looks' synthesized sounds, played through the overlay's AudioContext and volume
 * Dual-exported: a browser global for <script src>, CommonJS for node:test. No build step.
 */
(function (root) {
  var STYLES = (root && root.ATLETA_OBJECT_STYLES)
    || (typeof require === 'function' ? require('./index.js').STYLES : null)
    || {};
  if (root && !root.ATLETA_OBJECT_STYLES) root.ATLETA_OBJECT_STYLES = STYLES;

  // The six alerts a look can draw (the giveaway's event type is giveaway_winner).
  var ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner'];

  // ── Helpers for render(d) ─────────────────────────────────────────────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  // A donation amount as its currency writes it ("€25.00"), as index.js's money() does.
  function money(amount, currency) {
    var code = String(currency == null ? '' : currency).trim().toUpperCase();
    var number = Number(amount);
    if (amount == null || String(amount).trim() === '' || !isFinite(number)) {
      return ((code ? code + ' ' : '') + String(amount == null ? '' : amount)).trim();
    }
    if (/^[A-Z]{3}$/.test(code)) {
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(number); } catch (e) { /* the plain form below */ }
    }
    return (code ? code + ' ' : '') + number.toFixed(2);
  }

  function isWide(cp) {
    return (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3)
      || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60)
      || (cp >= 0xFFE0 && cp <= 0xFFE6) || cp >= 0x1F000;
  }
  function nameWidth(name) {
    var chars = Array.from(String(name == null ? '' : name)), width = 0;
    for (var i = 0; i < chars.length; i++) width += isWide(chars[i].codePointAt(0)) ? 1.5 : 1;
    return width;
  }
  // --fit scales a long name down (never below 0.6); what still does not fit ends in an ellipsis.
  function fitStyle(name, holds) {
    var width = nameWidth(name);
    var fit = width > holds ? Math.max(0.6, holds / width) : 1;
    return fit < 1 ? '--fit:' + fit.toFixed(2) + ';' : '';
  }
  // A name that fits its place (.o-nm in objects.css); `holds` is how many capitals fit at full size.
  function nm(cls, name, holds, extra) {
    return '<div class="' + cls + ' o-nm" style="' + fitStyle(name, holds) + (extra || '') + '"><span class="o-nm-t">' + esc(name) + '</span></div>';
  }
  // The samurai looks' name plaque (.o-name in objects.css), as index.js draws it.
  function samName(name, holds) {
    var fit = fitStyle(name, holds);
    return '<div class="o-name"' + (fit ? ' style="' + fit + '"' : '') + '><span class="o-name-text">' + esc(name) + '</span></div>';
  }
  function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
  // The look's main text: the streamer's own (d.label), or the look's words.
  function label(d, fallback) { return esc(d && d.label ? d.label : fallback); }

  // An odometer: every digit rolls to its value, the units spin twice, the tens once (.o-odo).
  var STRIP = (function () { var s = ''; for (var i = 0; i < 30; i++) s += '<i>' + (i % 10) + '</i>'; return s; })();
  function odo(text, delay, dur) {
    var chars = Array.from(String(text));
    var digits = chars.filter(function (c) { return c >= '0' && c <= '9'; }).length, seen = 0;
    var out = '<span class="o-odo" style="--odel:' + delay + 's;--odur:' + dur + 's">';
    chars.forEach(function (c) {
      if (c >= '0' && c <= '9') {
        var place = digits - 1 - seen++;
        var spins = place === 0 ? 2 : place === 1 ? 1 : 0;
        out += '<span class="o-odo-d"><span class="o-odo-strip" style="--to:' + (spins * 10 + Number(c)) + '">' + STRIP + '</span></span>';
      } else {
        out += '<span class="o-odo-s">' + esc(c) + '</span>';
      }
    });
    return out + '</span>';
  }
  // Typed text: one span per character, each shown a little after the one before (.o-typed).
  function typed(text, t0, per, max) {
    var chars = Array.from(String(text || ''));
    if (chars.length > max) chars = chars.slice(0, max - 1).concat('…');
    return {
      n: chars.length,
      style: '--t0:' + t0 + 's;--tper:' + per.toFixed(3) + 's;',
      html: chars.map(function (c, i) { return '<span class="o-ch" style="--ti:' + i + '">' + esc(c) + '</span>'; }).join(''),
    };
  }
  // Deterministic randomness for a look's details (never Math.random in render: the overlay and
  // the builder preview must draw the same picture).
  function hash(s) {
    var h = 2166136261 >>> 0, chars = Array.from(String(s));
    for (var i = 0; i < chars.length; i++) { h ^= chars[i].codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function code3(name) {
    var letters = Array.from(String(name || '')).filter(function (c) { return /[\p{L}\p{N}]/u.test(c); });
    return (letters.slice(0, 3).join('') || 'NEW').toUpperCase();
  }
  function intOf(v) { return Math.max(0, parseInt(v, 10) || 0); }

  // ── Colour ────────────────────────────────────────────────────────────
  var HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
  function rgbOf(hex) { var v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  // Dark or white text on a colour, whichever reads better.
  function onColour(hex) {
    var c = rgbOf(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.179 ? '#0B0B12' : '#FFFFFF';
  }
  function mix(rgb, to, t) { return rgb.map(function (c, i) { return Math.round(c + (to[i] - c) * t); }); }
  function toHex(rgb) { return '#' + rgb.map(function (c) { return ('0' + c.toString(16).toUpperCase()).slice(-2); }).join(''); }
  var WHITE = [255, 255, 255], BLACK = [0, 0, 0], MUTED = [242, 230, 230];
  // The variables a slot carries for a streamer's colour: the colour, its numbers, the text colour
  // that reads on it (also as numbers, for translucent text), and shades worked out from it. Today's
  // samurai looks read every one with today's colours as the fallback (objects.css), so a slot without
  // these looks exactly as it did.
  function accentVars(value) {
    if (typeof value !== 'string' || !HEX_COLOUR.test(value)) return '';
    var base = value.toUpperCase(), c = rgbOf(base), on = onColour(base);
    return '--a:' + base + ';--a-rgb:' + c.join(',') + ';--a-on:' + on + ';--a-on-rgb:' + rgbOf(on).join(',')
      + ';--a-hi:' + toHex(mix(c, WHITE, 0.18)) + ';--a-lo:' + toHex(mix(c, BLACK, 0.2))
      + ';--a-deep:' + toHex(mix(c, BLACK, 0.45)) + ';--a-night:' + toHex(mix(c, BLACK, 0.72))
      + ';--a-ink:' + toHex(mix(c, BLACK, 0.86)) + ';--a-soft:' + toHex(mix(c, MUTED, 0.5))
      + ';--a-tint:' + toHex(mix(c, WHITE, 0.38)) + ';';
  }

  // ── What a look is handed ─────────────────────────────────────────────
  // The middle picture ("grows with the amount" off): what a look draws for these, whatever came.
  var MIDDLE = { bits: 500, raid: 42, months: 4, donation: 25 };
  function sizeOf(d, kind) {
    if (d && d.grows === false && Object.prototype.hasOwnProperty.call(MIDDLE, kind)) return MIDDLE[kind];
    var value = !d ? 0 : kind === 'raid' ? d.viewers : kind === 'months' ? d.months : (d.amount != null ? d.amount : d.bits);
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }
  // What a look is handed besides the event, from the alert's saved design. Racing keeps today's
  // columns (its card, accent and name colours, its font and event_label); the other looks read
  // their own (style_label). style_grows 0 is "grows with the amount" off.
  function lookData(look, data, design) {
    var d = {}, k, src = data || {}, s = design || {}, c = (look && look.controls) || {};
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) d[k] = src[k];
    if (c.colour === 'racing') {
      d.label = s.event_label || '';
      d.colours = { bg: s.bg_color, accent: s.accent_color, name: s.username_color || s.text_color, font: s.username_font_family };
    } else if (c.label) {
      d.label = s.style_label || '';
    }
    d.grows = s.style_grows !== 0;
    return d;
  }
  // The CSS variables a look's slot carries: the streamer's colour (with its shades) for a look that
  // takes one, and the speed for a look that takes it (today's five keep 1, objects.css's default).
  function slotVars(look, design) {
    var c = (look && look.controls) || {}, s = design || {}, out = {};
    if (c.colour === 'accent') {
      accentVars(s.style_accent).split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1);
      });
    }
    if (c.speed) {
      var n = Number(s.animation_speed);
      out['--spd'] = String(isFinite(n) && n > 0 ? Math.min(2, Math.max(0.5, n)) : 1);
    }
    return out;
  }

  // ── Families and looks ────────────────────────────────────────────────
  var FAMILIES = {};
  // A family: its key, its place in the gallery and the Google Fonts it needs ("Kanit:wght@900").
  // Anything else given (a family's defaults) is kept as it is.
  function registerFamily(def) {
    if (!def || typeof def.key !== 'string' || typeof def.order !== 'number') throw new Error('registerFamily: a key and an order are required');
    var family = {}, k;
    for (k in def) if (Object.prototype.hasOwnProperty.call(def, k)) family[k] = def[k];
    family.fonts = (def.fonts || []).slice();
    FAMILIES[def.key] = family;
  }
  // The CSS names of a family's fonts ("Barlow+Condensed:wght@700" is "Barlow Condensed").
  function fontNames(familyKey) {
    var family = FAMILIES[familyKey];
    return family ? family.fonts.map(function (spec) { return spec.split(':')[0].replace(/\+/g, ' '); }) : [];
  }
  function register(look) {
    if (!look || typeof look.key !== 'string' || ALERTS.indexOf(look.eventType) < 0) {
      throw new Error('register: a key and one of the six alert types are required (' + (look && look.key) + ')');
    }
    if (!FAMILIES[look.family]) throw new Error('register: the family "' + look.family + '" of ' + look.key + ' is not registered');
    if (typeof look.render !== 'function') throw new Error('register: ' + look.key + ' has no render');
    STYLES[look.key] = look;
  }
  // An alert's looks in the gallery's order (by family). The C1 has no family: it is not listed here.
  function looksOf(eventType) {
    return Object.keys(STYLES).map(function (k) { return STYLES[k]; })
      .filter(function (s) { return s.eventType === eventType && s.family && FAMILIES[s.family]; })
      .sort(function (a, b) { return FAMILIES[a.family].order - FAMILIES[b.family].order; });
  }

  // ── The look an alert draws, its effect and its sound ────────────────
  // While an alert's design names no look (overlay_designs.style NULL) it draws its default look:
  // today's object for the five Twitch alerts (index.js: nothing changes until the streamer picks a
  // look), and Racing's Victory lap for the giveaway, improved in place. objectFor() in overlay.js
  // and previewObjectFor() in the builder read this table.
  var DEFAULT_LOOKS = { giveaway_winner: 'giveaway-racing' };
  var SOUNDS = {};
  var SOUND_FAMILIES = {};

  // The screen effect an alert plays with its look ('none', a name from overlay.js, or one of fx.js).
  // Today's five objects with no style and the C1 have none, as before; a look the streamer picked
  // plays the design's effect, 'default' being the look's own. The giveaway's default look plays its
  // saved effect too: what the streamer saved for the old card carries over.
  function effectFor(look, design) {
    if (!look || !look.family) return 'none';
    var chosen = design && design.screen_effect;
    return chosen && chosen !== 'default' ? chosen : (look.fx || 'none');
  }

  // The sound an alert plays after any sound the streamer uploaded (overlay.js plays that first):
  // the design's style_sound when this page knows it ('none' is silence, 'today' the alert's sound
  // from before the styles), else the look's own; today's five objects and the C1 play today's.
  function soundFor(look, design) {
    var key = design && design.style_sound;
    if (key === 'none' || key === 'today' || (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SOUNDS, key))) return key;
    return (look && look.sound) || 'today';
  }

  // ── Sounds ────────────────────────────────────────────────────────────
  var audio = { ctx: null, volume: function () { return 0.8; }, buffer: null };
  // overlay.js hands its AudioContext and its volume (overlayVolume) once; the builder its own.
  function setAudio(ctx, volume) { audio.ctx = ctx || null; audio.buffer = null; if (typeof volume === 'function') audio.volume = volume; }
  // A look's sound, under its family (the builder lists the sounds by family).
  function registerSound(key, family, fn) {
    if (!FAMILIES[family]) throw new Error('registerSound: the family "' + family + '" of ' + key + ' is not registered');
    SOUNDS[key] = fn;
    SOUND_FAMILIES[key] = family;
  }
  // Plays a look's sound; false when there is no such sound or nothing to play it with.
  function playSound(key) {
    var fn = SOUNDS[key];
    if (!fn || !audio.ctx) return false;
    try { fn(); return true; } catch (e) { return false; }
  }
  function level(v) { return Math.max(0.0001, (v || 0.1) * audio.volume()); }
  function envelope(g, t0, v, a, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(level(v), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); }
  function tone(o) {
    var c = audio.ctx; if (!c) return;
    var t0 = c.currentTime + (o.t || 0), d = o.d || 0.2, osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
    envelope(g, t0, o.v, o.a || 0.005, d); osc.connect(g); g.connect(c.destination); osc.start(t0); osc.stop(t0 + d + 0.05);
  }
  function noise(o) {
    var c = audio.ctx; if (!c) return;
    if (!audio.buffer) {
      audio.buffer = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
      var ch = audio.buffer.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    var t0 = c.currentTime + (o.t || 0), d = o.d || 0.2, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = audio.buffer; f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
    f.Q.value = o.q || 1; envelope(g, t0, o.v, o.a || 0.005, d);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0); src.stop(t0 + d + 0.05);
  }
  function engine(o) {
    var c = audio.ctx; if (!c) return;
    var t0 = c.currentTime + (o.t || 0), d = o.d || 0.6, ws = c.createWaveShaper(), curve = new Float32Array(256), g = c.createGain();
    for (var i = 0; i < 256; i++) { var x = i * 2 / 256 - 1; curve[i] = (Math.PI + 3.4) * x / (Math.PI + 3.4 * Math.abs(x)); }
    ws.curve = curve;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(level(o.v), t0 + 0.02);
    g.gain.setValueAtTime(level(o.v), t0 + d * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    [1, 0.5].forEach(function (m) {
      var osc = c.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(o.f * m, t0); osc.frequency.exponentialRampToValueAtTime(o.f2 * m, t0 + d * 0.75);
      osc.connect(ws); osc.start(t0); osc.stop(t0 + d);
    });
    ws.connect(g); g.connect(c.destination);
  }

  var KIT = {
    ALERTS: ALERTS, MIDDLE: MIDDLE, styles: STYLES, families: FAMILIES, sounds: SOUNDS, soundFamilies: SOUND_FAMILIES,
    esc: esc, money: money, fitStyle: fitStyle, nm: nm, samName: samName, fmt: fmt, label: label, odo: odo, typed: typed,
    hash: hash, rng: rng, code3: code3, intOf: intOf, isWide: isWide, rgbOf: rgbOf, onColour: onColour, accentVars: accentVars,
    sizeOf: sizeOf, lookData: lookData, slotVars: slotVars, DEFAULT_LOOKS: DEFAULT_LOOKS, effectFor: effectFor, soundFor: soundFor,
    registerFamily: registerFamily, fontNames: fontNames, register: register, looksOf: looksOf,
    setAudio: setAudio, registerSound: registerSound, playSound: playSound, tone: tone, noise: noise, engine: engine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
  if (root) root.ATLETA_KIT = KIT;
})(typeof window !== 'undefined' ? window : null);
