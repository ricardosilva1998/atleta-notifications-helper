'use strict';

/**
 * The Overlay Builder's alert cards (docs/superpowers/specs/2026-10-16-overlay-builder-cards-design.md):
 * one card per alert, each looping the look it is set to on a faux stream, with its sound and its place,
 * Test in OBS and Edit alert. The page-free rules are window.ATLETA_BUILDER_STYLES
 * (public/js/builder-styles-core.js); the looks are drawn with the files the OBS overlay uses
 * (objects/kit.js and the joined family files), picked with the view's previewObjectFor().
 *
 * It reads what the view's inline script defines (src/views/overlay-builder.ejs): previewObjectFor,
 * ALERT_STYLES, SERVER_DESIGNS, STYLE_DATA, EVENT_DEFAULTS, PREVIEW_DATA, I18N, sponsorImages,
 * sponsorRotationEnabled, STREAMER_ID, and window.BUILDER / window.BUILDER_TEXTS, so it is loaded after
 * that script. Dual-exported: a browser global (window.ATLETA_BUILDER_CARDS) for <script src>, CommonJS
 * for tests/builderCards.test.js (which runs it under node:vm).
 */
(function (root) {
  var LOOK_WIDTH = 420;   // a look is drawn for 420 px and scaled, as .alert-pos.look in OBS

  function core() { return root.ATLETA_BUILDER_STYLES; }
  function kit() { return root.ATLETA_KIT; }

  // ── A looping preview of a look in a slot ──
  // get() -> { look, design, sample }. Plays the entrance, holds, plays the exit at the look's speed,
  // pauses, and again. opts: { hold = 2000, gap = 700, offset = 0, onPlay(look, design) }; an offset
  // delays the first play only, so a gallery never pauses all at once. Nothing a look does escapes: one
  // that throws while drawing leaves the slot empty for that loop, and the loop goes on.
  function Looper(slot, get, opts) {
    this.slot = slot;
    this.get = get;
    this.opts = opts || {};
    this.timers = [];
    this.vars = [];     // the slot variables the last play set (kit.slotVars)
    this.running = false;
  }
  Looper.prototype.later = function (fn, ms) {
    var self = this;
    var id = setTimeout(function () {
      self.timers = self.timers.filter(function (t) { return t !== id; });
      fn();
    }, ms);
    this.timers.push(id);
  };
  Looper.prototype.clear = function () {
    this.slot.classList.remove('playing', 'exiting');
    this.slot.innerHTML = '';
  };
  Looper.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    var self = this, offset = Number(this.opts.offset) || 0;
    if (offset > 0) this.later(function () { self.cycle(); }, offset);
    else this.cycle();
  };
  Looper.prototype.stop = function () {
    this.running = false;
    this.timers.forEach(function (t) { clearTimeout(t); });
    this.timers = [];
    this.clear();
  };
  Looper.prototype.restart = function () { this.stop(); this.start(); };
  Looper.prototype.cycle = function () {
    if (!this.running) return;
    var self = this, C = core();
    var hold = this.opts.hold == null ? 2000 : this.opts.hold;
    var gap = this.opts.gap == null ? 700 : this.opts.gap;
    var look = null, timings = { inMs: 0, exitMs: 400 }, played = false;
    try {
      var got = this.get() || {};
      look = got.look;
      if (!look) return;   // nothing to play (a card without a look): no loop
      var design = got.design || {};
      timings = C.loopTimings(look, C.speedOf(look, design));
      played = this.play(look, design, got.sample || {});
    } catch (e) {
      played = false;
    }
    if (!played) this.clear();
    this.later(function () {
      if (played) self.exit(look);
      self.later(function () {
        self.clear();
        self.later(function () { self.cycle(); }, gap);
      }, timings.exitMs + 50);
    }, timings.inMs + hold);
  };
  // Draws the look as OBS does (kit.lookData for a look of the styles, the sample as it is for today's
  // objects and the C1), sets its colour and speed (kit.slotVars) and plays its entrance.
  Looper.prototype.play = function (look, design, sample) {
    var K = kit(), slot = this.slot;
    var html = look.render(K && look.family ? K.lookData(look, sample, design) : sample);
    slot.classList.remove('playing', 'exiting');
    slot.innerHTML = html || '';
    this.vars.forEach(function (name) { slot.style.removeProperty(name); });
    var vars = K && look.family ? K.slotVars(look, design) : {};
    Object.keys(vars).forEach(function (name) { slot.style.setProperty(name, vars[name]); });
    this.vars = Object.keys(vars);
    slot.style.setProperty('--in', look.anim.in);
    slot.style.setProperty('--dur', look.anim.dur);
    slot.style.setProperty('--ease', look.anim.ease);
    void slot.offsetWidth;   // a reflow, so the entrance starts again
    slot.classList.add('playing');
    if (this.opts.onPlay) {
      try { this.opts.onPlay(look, design); } catch (e) { /* a sound that cannot play does not stop the loop */ }
    }
    return true;
  };
  // The look's exit, as the OBS overlay plays it (.exiting in objects.css).
  Looper.prototype.exit = function (look) {
    if (!look || !look.exit) return;
    var slot = this.slot;
    slot.style.setProperty('--out', look.exit.out);
    slot.style.setProperty('--outdur', look.exit.dur);
    slot.style.setProperty('--outease', look.exit.ease);
    slot.classList.remove('playing');
    slot.classList.add('exiting');
  };

  // A look of the alert styles is drawn for 420 px and scaled to the width (--zw, as .alert-pos.look in
  // OBS); today's objects, the Samurai presets among them, and the C1 reflow instead, so they are drawn
  // at 420 px and the slot is zoomed.
  function fitAlert(slot, look, width) {
    var scaled = !!(look && look.family && !look.preset);
    var scale = String(Math.round(width / LOOK_WIDTH * 1000) / 1000);
    slot.classList.toggle('look', scaled);
    if (scaled) {
      slot.style.width = width + 'px';
      slot.style.zoom = '';
      slot.style.setProperty('--zw', scale);
    } else {
      slot.style.width = LOOK_WIDTH + 'px';
      slot.style.zoom = scale;
      slot.style.removeProperty('--zw');
    }
  }

  // The stored row of an alert (SERVER_DESIGNS, as the page was given it), or null.
  function storedRow(type) {
    var rows = typeof SERVER_DESIGNS !== 'undefined' && Array.isArray(SERVER_DESIGNS) ? SERVER_DESIGNS : [];
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].event_type === type) return rows[i];
    return null;
  }
  // An alert's working design: its stored row over the alert's defaults (EVENT_DEFAULTS); an alert with no
  // look stored is shown with its default look's own settings, as OBS plays it (STYLE_CORE.untouched).
  function designOf(type) {
    var defaults = typeof EVENT_DEFAULTS !== 'undefined' && EVENT_DEFAULTS[type] ? EVENT_DEFAULTS[type] : {};
    var design = Object.assign({}, defaults, storedRow(type) || {});
    var styles = typeof ALERT_STYLES !== 'undefined' ? ALERT_STYLES : {};
    return core().untouched(type, design, styles[type]);
  }

  // The cards the page shows, in order: the six alerts and the sponsor images; the YouTube alerts only
  // while YouTube is switched on.
  function shownCards(features) {
    var youtube = !!(features && features.youtube);
    return core().CARD_TYPES.filter(function (type) { return youtube || !/^yt_/.test(type); });
  }

  // Each card's icon: the emoji the builder's alert tabs had.
  var CARD_ICONS = {
    follow: '🏁', subscription: '🏆', bits: '⛽', donation: '💰', raid: '🤖', giveaway_winner: '🎁',
    timed: '⏰', yt_superchat: '💬', yt_member: '⭐', yt_giftmember: '🎁',
  };
  var POSITIONS = ['top-left', 'top-center', 'top-right', 'mid-left', 'mid-center', 'mid-right', 'bot-left', 'bot-center', 'bot-right'];

  // ── Texts ──
  function builder() { return root.BUILDER || {}; }
  function text(key, values) {
    var s = (root.BUILDER_TEXTS && root.BUILDER_TEXTS[key]) || '';
    return s.replace(/\{\{(\w+)\}\}/g, function (_, name) { return values && values[name] != null ? values[name] : ''; });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pageTexts() { return typeof I18N !== 'undefined' ? I18N : {}; }
  function styleData() { return typeof STYLE_DATA !== 'undefined' ? STYLE_DATA : { looks: {}, families: [], sounds: [], defaults: {} }; }
  function cardName(type) {
    if (type === 'timed') return text('cards.sponsors');
    return (pageTexts().eventNames || {})[type] || type;
  }
  // "<look> · <theme> · default" under the card's name.
  function lookLine(type, look) {
    if (!look) return '';
    var data = styleData();
    var title = data.looks && data.looks[look.key] && data.looks[look.key].title;
    var family = look.family && (data.families || []).filter(function (f) { return f.key === look.family; })[0];
    var parts = [title, family && family.name];
    if (data.defaults && data.defaults[type] === look.key) parts.push(text('cards.default'));
    return parts.filter(Boolean).join(' · ');
  }
  // The sound the alert plays in OBS: one the streamer uploaded for it comes first (overlay settings).
  function soundLabel(type, look, design) {
    if ((builder().uploadedSounds || {})[type]) return text('cards.uploaded');
    var key = kit().soundFor(look, design);
    if (key === 'today') return text('sound.today');
    if (key === 'none') return text('sound.none');
    var groups = styleData().sounds || [];
    for (var i = 0; i < groups.length; i++) {
      for (var j = 0; j < groups[i].sounds.length; j++) if (groups[i].sounds[j].key === key) return groups[i].sounds[j].name;
    }
    return key;
  }
  // Where the alert sits: a 3x3 dot grid and "Top centre" / "Free position".
  function placeChip(design) {
    var place = core().placeSummary(design);
    var dots = POSITIONS.map(function (_, i) { return '<i class="' + (place.free || i === place.cell ? 'on' : '') + '"></i>'; }).join('');
    var parts = place.position.split('-');
    var label = place.free ? text('cards.free') : text('place.' + parts[0]) + ' ' + text('place.' + parts[1]);
    return '<span class="chip"><span class="ecard-dots" aria-hidden="true">' + dots + '</span>' + esc(label) + '</span>';
  }

  // ── Sound (the page's own AudioContext, made on the first click, as browsers require) ──
  var audio = null;
  function playLookSound(key) {
    var K = kit();
    if (!K || !key || key === 'today' || key === 'none') return;   // the engine sound lives in OBS only
    if (!audio) {
      var Context = root.AudioContext || root.webkitAudioContext;
      if (!Context) return;
      try { audio = new Context(); } catch (e) { return; }
    }
    K.setAudio(audio, function () { return 0.8; });
    if (audio.state === 'suspended') audio.resume();
    K.playSound(key);
  }

  // ── The cards ──
  // Loops run only while their card is on screen (one IntersectionObserver); the alert's width follows
  // the preview's (one ResizeObserver per card).
  var loopers = new Map();
  var resizers = [];
  var observer = null;
  function onScreen(entries) {
    entries.forEach(function (entry) {
      var lp = loopers.get(entry.target);
      if (!lp) return;
      if (entry.isIntersecting) lp.start(); else lp.stop();
    });
  }
  function watch(el, lp) {
    loopers.set(el, lp);
    if (!observer && root.IntersectionObserver) observer = new root.IntersectionObserver(onScreen, { rootMargin: '80px' });
    if (observer) observer.observe(el); else lp.start();
  }
  function teardown() {
    loopers.forEach(function (lp, el) { lp.stop(); if (observer) observer.unobserve(el); });
    loopers.clear();
    resizers.forEach(function (ro) { ro.disconnect(); });
    resizers = [];
  }

  // The edit window comes with the next task; until then the cards open nothing.
  function openEditor(type) { /* Task 4 */ }

  function previewBackground(preview) {
    var thumb = builder().streamThumbnail;
    if (thumb) preview.querySelector('.stream-bg').style.backgroundImage = 'url(' + JSON.stringify(String(thumb)) + ')';
  }
  function bindEdit(card, type) {
    var preview = card.querySelector('.ecard-preview');
    preview.addEventListener('click', function () { CARDS.openEditor(type); });
    preview.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); CARDS.openEditor(type); }
    });
    card.querySelector('[data-act="edit"]').addEventListener('click', function () { CARDS.openEditor(type); });
  }

  // ▶ Test in OBS: the saved alert plays in OBS (the overlay's test route, no test thank-you in the Twitch
  // chat), and the card's preview plays again with its sound.
  function testInObs(type, msg) {
    var texts = pageTexts().style || {};
    msg.textContent = '';
    return fetch('/dashboard/overlay/test/' + encodeURIComponent(type), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: false }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        msg.textContent = res.ok ? (texts.testSent || '') : (data.error || texts.failed || '');
      });
    }).catch(function () { msg.textContent = texts.failed || ''; });
  }

  function alertCard(doc, type) {
    var look = typeof previewObjectFor === 'function' ? previewObjectFor(type) : null;
    var design = designOf(type);
    var name = cardName(type);
    var card = doc.createElement('article');
    card.className = 'ecard';
    card.setAttribute('data-card', type);
    var chips = (look ? '<span class="chip">🔊 ' + esc(soundLabel(type, look, design)) + '</span>' : '') + placeChip(design);
    card.innerHTML =
      '<div class="ecard-head">' +
        '<span class="ecard-icon" aria-hidden="true">' + CARD_ICONS[type] + '</span>' +
        '<div class="ecard-names"><h3 class="ecard-title">' + esc(name) + '</h3>' +
        '<div class="ecard-look">' + esc(lookLine(type, look)) + '</div></div>' +
      '</div>' +
      '<div class="ecard-preview" role="button" tabindex="0" aria-label="' + esc(text('cards.edit') + ': ' + name) + '">' +
        '<div class="stream-bg"></div><div class="mini-slot"></div>' +
      '</div>' +
      '<div class="ecard-meta">' + chips + '</div>' +
      '<div class="ecard-foot">' +
        '<button type="button" class="btn btn-secondary" data-act="test">▶ ' + esc(text('cards.test')) + '</button>' +
        '<span class="ecard-msg" aria-live="polite"></span>' +
        '<button type="button" class="btn btn-primary" data-act="edit">' + esc(text('cards.edit')) + '</button>' +
      '</div>';
    var preview = card.querySelector('.ecard-preview');
    var slot = card.querySelector('.mini-slot');
    previewBackground(preview);

    // The alert fills about two thirds of the preview's width (280-760 px), whatever the window.
    function fit() { fitAlert(slot, look, Math.round(Math.min(760, Math.max(280, preview.clientWidth * 0.62)))); }
    fit();
    if (root.ResizeObserver) {
      var ro = new root.ResizeObserver(fit);
      ro.observe(preview);
      resizers.push(ro);
    }

    var withSound = false;
    var lp = new Looper(slot, function () {
      return { look: look, design: design, sample: (typeof PREVIEW_DATA !== 'undefined' && PREVIEW_DATA[type]) || {} };
    }, {
      hold: 2200,
      gap: 900,
      onPlay: function (played, d) {
        if (!withSound) return;
        withSound = false;
        if (!(builder().uploadedSounds || {})[type]) playLookSound(kit().soundFor(played, d));
      },
    });
    if (look) watch(card, lp);

    card.querySelector('[data-act="test"]').addEventListener('click', function () {
      if (look) { withSound = true; lp.restart(); }
      testInObs(type, card.querySelector('.ecard-msg'));
    });
    bindEdit(card, type);
    return card;
  }

  // The sponsor images card: the image that rotates first, in the banner, fading in and out; whether the
  // rotation is on and how many images there are.
  function sponsorCard(doc) {
    var images = typeof sponsorImages !== 'undefined' && Array.isArray(sponsorImages) ? sponsorImages : [];
    var rotation = typeof sponsorRotationEnabled !== 'undefined' && !!sponsorRotationEnabled;
    var first = images.filter(function (s) { return s.enabled; })[0];
    var name = cardName('timed');
    var card = doc.createElement('article');
    card.className = 'ecard';
    card.setAttribute('data-card', 'timed');
    card.innerHTML =
      '<div class="ecard-head">' +
        '<span class="ecard-icon" aria-hidden="true">' + CARD_ICONS.timed + '</span>' +
        '<div class="ecard-names"><h3 class="ecard-title">' + esc(name) + '</h3></div>' +
      '</div>' +
      '<div class="ecard-preview" role="button" tabindex="0" aria-label="' + esc(text('cards.editSponsors')) + '">' +
        '<div class="stream-bg"></div>' + (first ? '<div class="ecard-sponsor"><img alt=""></div>' : '') +
      '</div>' +
      '<div class="ecard-meta">' +
        '<span class="chip">' + esc(text(rotation ? 'cards.rotationOn' : 'cards.rotationOff')) + '</span>' +
        '<span class="chip">🖼️ ' + esc(text('cards.images', { count: images.length })) + '</span>' +
      '</div>' +
      '<div class="ecard-foot">' +
        '<button type="button" class="btn btn-primary" data-act="edit">' + esc(text('cards.editSponsors')) + '</button>' +
      '</div>';
    previewBackground(card.querySelector('.ecard-preview'));
    if (first) {
      var banner = card.querySelector('.ecard-sponsor');
      var img = banner.querySelector('img');
      img.src = '/sponsors/' + (typeof STREAMER_ID !== 'undefined' ? STREAMER_ID : '') + '/' + encodeURIComponent(first.filename);
      var scale = first.image_scale != null ? Number(first.image_scale) : 1;
      if (scale < 1) img.style.maxWidth = img.style.maxHeight = (scale * 100) + '%';
      // Its loop is a CSS animation, run only while the card is on screen.
      watch(card, {
        start: function () { banner.classList.add('playing'); },
        stop: function () { banner.classList.remove('playing'); },
      });
    }
    bindEdit(card, 'timed');
    return card;
  }

  // Draws every card again, in CARD_TYPES order: the Twitch alerts in #cards, the YouTube alerts in
  // #cards-youtube (only while YouTube is on), the sponsor images in #cards-other.
  function renderCards() {
    var doc = root.document;
    teardown();
    var boxes = { twitch: doc.getElementById('cards'), youtube: doc.getElementById('cards-youtube'), other: doc.getElementById('cards-other') };
    Object.keys(boxes).forEach(function (k) { if (boxes[k]) boxes[k].innerHTML = ''; });
    shownCards(builder().features).forEach(function (type) {
      var box = type === 'timed' ? boxes.other : /^yt_/.test(type) ? boxes.youtube : boxes.twitch;
      if (!box) return;
      box.appendChild(type === 'timed' ? sponsorCard(doc) : alertCard(doc, type));
    });
  }

  var CARDS = {
    Looper: Looper, fitAlert: fitAlert, designOf: designOf, shownCards: shownCards, renderCards: renderCards,
    openEditor: openEditor, CARD_ICONS: CARD_ICONS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CARDS;
  if (root) root.ATLETA_BUILDER_CARDS = CARDS;

  // On the page: draw the cards once the script is loaded (it comes after the markup).
  if (root && root.document && root.document.getElementById && root.document.getElementById('cards')) renderCards();
})(typeof window !== 'undefined' ? window : null);
