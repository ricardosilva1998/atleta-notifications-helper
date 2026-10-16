'use strict';

/**
 * The Overlay Builder's alert cards (docs/superpowers/specs/2026-10-16-overlay-builder-cards-design.md):
 * one card per alert, each looping the look it is set to on a faux stream, with its sound and its place,
 * Test in OBS and Edit alert, and the edit window Edit alert opens (Done saves the alert). The page-free
 * rules are window.ATLETA_BUILDER_STYLES
 * (public/js/builder-styles-core.js); the looks are drawn with the files the OBS overlay uses
 * (objects/kit.js and the joined family files), picked with the view's previewObjectFor().
 *
 * It reads what the view's inline script defines (src/views/overlay-builder.ejs): previewObjectFor,
 * ALERT_STYLES, SAVED_STYLES, SERVER_DESIGNS, SAVED_DESIGNS, STYLE_DATA, EVENT_DEFAULTS, PREVIEW_DATA, I18N,
 * sponsorImages, sponsorRotationEnabled, STREAMER_ID, currentType (set for the legacy controls), and
 * window.BUILDER / window.BUILDER_TEXTS, so it is loaded after
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
      if (!look) { this.running = false; return; }   // nothing to play (a card without a look): no loop, and a later start() tries again
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
  // Where the alert sits, in words: "Top centre" or "Free position".
  function placeLabel(design) {
    var place = core().placeSummary(design);
    var parts = place.position.split('-');
    return place.free ? text('cards.free') : text('place.' + parts[0]) + ' ' + text('place.' + parts[1]);
  }
  // Where the alert sits: a 3x3 dot grid and its place in words.
  function placeChip(design) {
    var place = core().placeSummary(design);
    var dots = POSITIONS.map(function (_, i) { return '<i class="' + (place.free || i === place.cell ? 'on' : '') + '"></i>'; }).join('');
    return '<span class="chip"><span class="ecard-dots" aria-hidden="true">' + dots + '</span>' + esc(placeLabel(design)) + '</span>';
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
  // Loops run only while their card is on screen (one IntersectionObserver on the cards' scrolling page)
  // and the edit window is closed; the alert's width follows the preview's (one ResizeObserver per card).
  var loopers = new Map();
  var resizers = [];
  var observer = null;
  var onScreenCards = new Set();
  var paused = false;
  function onScreen(entries) {
    entries.forEach(function (entry) {
      var lp = loopers.get(entry.target);
      if (!lp) return;
      if (entry.isIntersecting) {
        onScreenCards.add(entry.target);
        if (!paused) lp.start();
      } else {
        onScreenCards.delete(entry.target);
        lp.stop();
      }
    });
  }
  // A card's loop (anything with start() and stop()), run while the card is on screen and no window is open.
  function watch(el, lp) {
    loopers.set(el, lp);
    if (!observer && root.IntersectionObserver) {
      var page = root.document && root.document.querySelector ? root.document.querySelector('.cards-page') : null;
      observer = new root.IntersectionObserver(onScreen, { root: page, rootMargin: '80px' });
    }
    if (observer) observer.observe(el);
    else {
      onScreenCards.add(el);
      if (!paused) lp.start();
    }
  }
  function teardown() {
    loopers.forEach(function (lp, el) { lp.stop(); if (observer) observer.unobserve(el); });
    loopers.clear();
    onScreenCards.clear();
    resizers.forEach(function (ro) { ro.disconnect(); });
    resizers = [];
  }
  // The edit window stops the cards behind it, and starts the ones on screen again when it closes.
  function pauseCards() {
    paused = true;
    loopers.forEach(function (lp) { lp.stop(); });
  }
  function resumeCards() {
    paused = false;
    loopers.forEach(function (lp, el) { if (onScreenCards.has(el)) lp.start(); });
  }

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

  // ── The edit window ──
  // One alert at a time: CARDS.editing is the card, CARDS.draft its working design and CARDS.draftStyle
  // the look it shows (null for the cards without looks). Nothing is stored until Done (saveDraft); Reset
  // acts at once. The panes are filled by the code each tab belongs to, through CARDS.panes[name]
  // ({ show(), hide() }, both optional); the stage (#stage) shows on Location and Design only.
  var TAB_ICONS = { animation: '✨', customize: '🎨', sound: '🔊', location: '📍', images: '🖼️', design: '🖌️' };
  var PANES = ['animation', 'customize', 'sound', 'location', 'images', 'design'];
  var opened = null;        // { design, style } as the window opened (or was last stored): isDirty() compares
  var tabValues = {};       // the value span of each tab in the bar
  var opener = null;        // what had the focus, given back on close
  var saving = false;

  function el(id) { return root.document ? root.document.getElementById(id) : null; }
  function copy(design) { return Object.assign({}, design || {}); }
  // The design an alert's window edits: its working design without the stored row's own columns (the
  // look travels next to the design, in the save's `style`).
  var ROW_COLUMNS = ['id', 'streamer_id', 'event_type', 'style', 'design_version', 'created_at'];
  function draftOf(type) {
    var design = copy(designOf(type));
    ROW_COLUMNS.forEach(function (column) { delete design[column]; });
    return design;
  }
  function pageGlobal(name) {
    if (name === 'SAVED_STYLES') return typeof SAVED_STYLES !== 'undefined' ? SAVED_STYLES : null;
    if (name === 'ALERT_STYLES') return typeof ALERT_STYLES !== 'undefined' ? ALERT_STYLES : null;
    if (name === 'SAVED_DESIGNS') return typeof SAVED_DESIGNS !== 'undefined' ? SAVED_DESIGNS : null;
    if (name === 'SERVER_DESIGNS') return typeof SERVER_DESIGNS !== 'undefined' && Array.isArray(SERVER_DESIGNS) ? SERVER_DESIGNS : null;
    return null;
  }

  // The look the window shows when it opens: the stored one, else the alert's default look.
  function shownStyleOf(type) {
    return core().shownStyle(type, pageGlobal('ALERT_STYLES') || {}, styleData().defaults);
  }
  // The look object of the draft's look (an alert's own look only), else the one the page shows.
  function draftLook() {
    var type = CARDS.editing, id = CARDS.draftStyle;
    var styles = root.ATLETA_OBJECT_STYLES || {};
    var look = id && Object.prototype.hasOwnProperty.call(styles, id) ? styles[id] : null;
    if (look && look.key === id && look.eventType === type) return look;
    return typeof previewObjectFor === 'function' ? previewObjectFor(type) : null;
  }
  // The look as saved goes back where the page shows it (the server keeps an alert's look through
  // Cancel and Reset).
  function restoreSavedLook(type) {
    var saved = pageGlobal('SAVED_STYLES') || {}, shown = pageGlobal('ALERT_STYLES');
    if (!shown) return;
    if (saved[type]) shown[type] = saved[type];
    else delete shown[type];
  }
  // The stored row of an alert, as the cards read it (designOf): replaced, or removed with null.
  function storeRow(type, row) {
    var rows = pageGlobal('SERVER_DESIGNS'), byType = pageGlobal('SAVED_DESIGNS');
    if (rows) {
      var at = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].event_type === type) { at = i; break; }
      if (row && at >= 0) rows[at] = row;
      else if (row) rows.push(row);
      else if (at >= 0) rows.splice(at, 1);
    }
    if (byType) {
      if (row) byType[type] = row;
      else delete byType[type];
    }
  }

  // What a tab shows next to its name: the look, the sound, the place, the number of images.
  function tabValue(name) {
    var type = CARDS.editing, draft = CARDS.draft;
    if (!type || !draft) return '';
    if (name === 'animation') {
      var looks = styleData().looks || {};
      return (CARDS.draftStyle && looks[CARDS.draftStyle] && looks[CARDS.draftStyle].title) || '';
    }
    if (name === 'sound') {
      var look = draftLook();
      return look && kit() ? soundLabel(type, look, draft) : '';
    }
    if (name === 'location') return placeLabel(draft);
    if (name === 'images') {
      var images = typeof sponsorImages !== 'undefined' && Array.isArray(sponsorImages) ? sponsorImages : [];
      return text('cards.images', { count: images.length });
    }
    return '';
  }
  function renderTabValues() {
    Object.keys(tabValues).forEach(function (name) { tabValues[name].textContent = tabValue(name); });
  }

  function buildTabs(type) {
    var doc = root.document, bar = el('editor-tabs');
    tabValues = {};
    if (!bar) return;
    bar.innerHTML = '';
    core().tabsFor(type).forEach(function (name) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ed-tab';
      button.id = 'tab-' + name;
      button.setAttribute('role', 'tab');
      button.setAttribute('data-tab', name);
      button.setAttribute('aria-controls', 'pane-' + name);
      var label = doc.createElement('span');
      label.textContent = TAB_ICONS[name] + ' ' + text('tabs.' + name);
      var value = doc.createElement('span');
      value.className = 'tab-val';
      button.appendChild(label);
      button.appendChild(value);
      button.addEventListener('click', function () { setTab(name); });
      bar.appendChild(button);
      tabValues[name] = value;
    });
  }

  function paneHook(name, what) {
    var pane = CARDS.panes[name];
    if (pane && typeof pane[what] === 'function') {
      try { pane[what](); } catch (e) { if (root.console) root.console.error(e); }
    }
  }

  // Shows one of the card's tabs: its pane, and the stage on Location and Design.
  function setTab(name) {
    var type = CARDS.editing;
    if (!type || core().tabsFor(type).indexOf(name) < 0) return;
    var previous = CARDS.tab;
    if (previous && previous !== name) paneHook(previous, 'hide');
    CARDS.tab = name;
    var bar = el('editor-tabs');
    if (bar) Array.prototype.forEach.call(bar.children, function (button) {
      var on = button.getAttribute('data-tab') === name;
      button.setAttribute('aria-selected', String(on));
      button.setAttribute('tabindex', on ? '0' : '-1');
    });
    PANES.forEach(function (p) { var pane = el('pane-' + p); if (pane) pane.hidden = p !== name; });
    var withStage = name === 'location' || name === 'design';
    var side = el('editor-side'), dialog = el('editor');
    if (side) side.hidden = !withStage;
    if (dialog) {
      dialog.classList.toggle('with-stage', withStage);
      dialog.setAttribute('data-tab', name);
    }
    renderTabValues();
    paneHook(name, 'show');
  }

  function showMessage(message, isError) {
    var msg = el('editor-msg');
    if (!msg) return;
    msg.textContent = message || '';
    msg.classList.toggle('error', !!isError);
  }

  // The ?tab= of the address follows the window, so a reload opens it again (the old builder kept its tab).
  function setUrlTab(type) {
    try {
      var url = new root.URL(root.location.href);
      if (type) url.searchParams.set('tab', type);
      else url.searchParams.delete('tab');
      root.history.replaceState(root.history.state, '', url);
    } catch (e) { /* no address to keep (tests) */ }
  }

  function openEditor(type) {
    if (!type || !core().tabsFor(type).length) return;
    if (CARDS.editing && !closeEditor()) return;
    var dialog = el('editor'), back = el('editor-back');
    if (!dialog) return;
    CARDS.editing = type;
    // The page's legacy controls (the Design tab) read the card they edit from currentType.
    if (typeof currentType !== 'undefined') currentType = type;
    CARDS.draft = draftOf(type);
    CARDS.draftStyle = core().isStyled(type) ? shownStyleOf(type) : null;
    opened = { design: copy(CARDS.draft), style: CARDS.draftStyle };
    CARDS.tab = null;

    var title = el('editor-title'), icon = el('editor-icon');
    if (title) title.textContent = type === 'timed' ? text('cards.editSponsors') : text('window.title', { alert: cardName(type) });
    if (icon) icon.textContent = CARD_ICONS[type] || '';
    showMessage('');
    buildTabs(type);
    pauseCards();
    opener = root.document ? root.document.activeElement : null;
    dialog.hidden = false;
    if (back) back.hidden = false;
    setTab(core().tabsFor(type)[0]);
    setUrlTab(type);
    var first = el('tab-' + CARDS.tab) || el('editor-close');
    if (first && first.focus) first.focus();
  }

  // Closes the window; with edits, and not forced, only once the streamer agrees to lose them. While
  // Done's save is on its way it stays open (Esc, Cancel, ✕ and the backdrop wait): the save will land.
  function closeEditor(options) {
    var force = !!(options && options.force);
    var type = CARDS.editing;
    if (!type) return true;
    if (saving && !force) return false;
    if (!force && isDirty() && !root.confirm(text('window.leave'))) return false;
    if (CARDS.tab) paneHook(CARDS.tab, 'hide');
    restoreSavedLook(type);
    CARDS.editing = null;
    CARDS.draft = null;
    CARDS.draftStyle = null;
    CARDS.tab = null;
    opened = null;
    var dialog = el('editor'), back = el('editor-back');
    if (dialog) dialog.hidden = true;
    if (back) back.hidden = true;
    showMessage('');
    setUrlTab(null);
    resumeCards();
    // The focus goes back where it was; when the cards were drawn again, to this card's Edit button.
    var focusTo = opener;
    if (focusTo && focusTo.isConnected === false && root.document.querySelector) focusTo = root.document.querySelector('.ecard[data-card="' + type + '"] [data-act="edit"]');
    if (focusTo && focusTo.focus) focusTo.focus();
    opener = null;
    return true;
  }

  function sameValue(a, b) {
    var x = a == null ? null : a, y = b == null ? null : b;
    if (x !== null && y !== null && typeof x === 'object') return JSON.stringify(x) === JSON.stringify(y);
    return x === y;
  }
  // Whether the window holds edits that are not stored: another look, or any field changed.
  function isDirty() {
    if (!CARDS.editing || !opened || !CARDS.draft) return false;
    if ((CARDS.draftStyle || null) !== (opened.style || null)) return true;
    var draft = CARDS.draft, was = opened.design, keys = {}, k;
    for (k in draft) if (Object.prototype.hasOwnProperty.call(draft, k)) keys[k] = true;
    for (k in was) if (Object.prototype.hasOwnProperty.call(was, k)) keys[k] = true;
    for (k in keys) if (!sameValue(draft[k], was[k])) return true;
    return false;
  }

  // Done: one save of this alert with the look the window shows (the overlay's save route, which pushes
  // it to an open OBS source); on success the page takes it as stored, the cards are drawn again and the
  // window closes; a refusal keeps the window open with the route's message.
  function saveDraft() {
    var type = CARDS.editing;
    if (!type || saving) return Promise.resolve({ ok: false });
    var design = copy(CARDS.draft), style = CARDS.draftStyle;
    var done = el('editor-done');
    // The window's other ways out wait for the answer too.
    var buttons = ['editor-done', 'editor-reset', 'editor-cancel', 'editor-close'].map(el).filter(Boolean);
    saving = true;
    buttons.forEach(function (button) { button.disabled = true; });
    if (done) done.textContent = text('window.saving');
    showMessage('');
    function finish(result) {
      saving = false;
      buttons.forEach(function (button) { button.disabled = false; });
      if (done) done.textContent = text('window.done');
      return result;
    }
    return fetch('/dashboard/overlay-builder/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(core().savePayload(type, design, style)),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.ok) {
          var error = (data && data.error) || text('saveFailed');
          showMessage(error, true);
          return finish({ ok: false, error: error });
        }
        var row = Object.assign({}, storedRow(type) || {}, design, { event_type: type });
        if (core().isStyled(type)) {
          row.style = style || null;
          var saved = pageGlobal('SAVED_STYLES') || {}, shown = pageGlobal('ALERT_STYLES') || {};
          if (style) saved[type] = shown[type] = style;
          else { delete saved[type]; delete shown[type]; }
        }
        storeRow(type, row);
        finish(null);
        CARDS.renderCards();
        if (CARDS.editing === type) closeEditor({ force: true });   // never another card's window
        return { ok: true };
      });
    }).catch(function (e) {
      var error = text('saveFailedWith', { error: e && e.message });
      showMessage(error, true);
      return finish({ ok: false, error: error });
    });
  }

  // Reset: today's reset route, after its confirmation. The stored design goes back to the defaults and
  // the alert keeps its saved look (its own settings start again); the window shows that, unedited.
  function resetDraft() {
    var type = CARDS.editing;
    if (!type || saving) return Promise.resolve({ ok: false });   // not while Done's save is on its way
    if (!root.confirm(text('resetConfirm', { name: cardName(type) }))) return Promise.resolve({ ok: false });
    return fetch('/dashboard/overlay-builder/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: type }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.ok) {
          var error = (data && data.error) || text('saveFailed');
          showMessage(error, true);
          return { ok: false, error: error };
        }
        var savedStyle = (pageGlobal('SAVED_STYLES') || {})[type];
        storeRow(type, savedStyle ? { event_type: type, style: savedStyle } : null);
        restoreSavedLook(type);
        if (CARDS.editing === type) {
          CARDS.draft = draftOf(type);
          CARDS.draftStyle = core().isStyled(type) ? shownStyleOf(type) : null;
          opened = { design: copy(CARDS.draft), style: CARDS.draftStyle };
          showMessage(text('resetDone'));
          renderTabValues();
          if (CARDS.tab) paneHook(CARDS.tab, 'show');
        }
        CARDS.renderCards();
        return { ok: true };
      });
    }).catch(function (e) {
      var error = text('saveFailedWith', { error: e && e.message });
      showMessage(error, true);
      return { ok: false, error: error };
    });
  }

  // ?tab=<card> opens that card's window, when the page shows the card.
  function openFromUrl(search) {
    var Params = root.URLSearchParams;
    if (!Params) return null;
    var type = core().cardForTab(new Params(search || '').get('tab'), shownCards(builder().features));
    if (type) CARDS.openEditor(type);
    return CARDS.editing === type ? type : null;
  }

  // The window's buttons, Esc, the tab bar's arrow keys, and the stage scaled to its width.
  function bindEditor() {
    var doc = root.document;
    function on(id, fn) { var node = el(id); if (node) node.addEventListener('click', fn); }
    on('editor-close', function () { closeEditor(); });
    on('editor-cancel', function () { closeEditor(); });
    on('editor-back', function () { closeEditor(); });
    on('editor-done', function () { saveDraft(); });
    on('editor-reset', function () { resetDraft(); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && CARDS.editing) { e.preventDefault(); closeEditor(); }
    });
    var bar = el('editor-tabs');
    if (bar) bar.addEventListener('keydown', function (e) {
      if (!CARDS.editing || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      var tabs = core().tabsFor(CARDS.editing), at = tabs.indexOf(CARDS.tab);
      var next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      e.preventDefault();
      setTab(next);
      var button = el('tab-' + next);
      if (button && button.focus) button.focus();
    });
    var stage = el('stage'), inner = el('stage-inner');
    if (stage && inner && root.ResizeObserver) {
      new root.ResizeObserver(function () { inner.style.transform = 'scale(' + (stage.clientWidth / 1920) + ')'; }).observe(stage);
    }
    var bg = el('stage-bg'), thumb = builder().streamThumbnail;
    if (bg && thumb) bg.style.backgroundImage = 'url(' + JSON.stringify(String(thumb)) + ')';
  }

  var CARDS = {
    Looper: Looper, fitAlert: fitAlert, designOf: designOf, shownCards: shownCards, renderCards: renderCards,
    CARD_ICONS: CARD_ICONS, watch: watch,
    // The edit window (the cards call CARDS.openEditor, late-bound)
    openEditor: openEditor, closeEditor: closeEditor, setTab: setTab, saveDraft: saveDraft, resetDraft: resetDraft,
    isDirty: isDirty, tabValue: tabValue, renderTabValues: renderTabValues, draftLook: draftLook, openFromUrl: openFromUrl,
    editing: null, draft: null, draftStyle: null, tab: null, panes: {},
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CARDS;
  if (root) root.ATLETA_BUILDER_CARDS = CARDS;

  // On the page (the script comes after the markup): the window's controls, the cards, and the window a
  // ?tab= asks for.
  var doc = root && root.document && root.document.getElementById ? root.document : null;
  if (doc && doc.getElementById('editor')) bindEditor();
  if (doc && doc.getElementById('cards')) {
    renderCards();
    openFromUrl(root.location && root.location.search);
  }
})(typeof window !== 'undefined' ? window : null);
