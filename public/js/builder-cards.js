'use strict';

/**
 * The Overlay Builder's alert cards (docs/superpowers/specs/2026-10-16-overlay-builder-cards-design.md):
 * one card per alert, each looping the look it is set to on a faux stream, with its sound and its place,
 * Test in OBS and Edit alert, and the edit window Edit alert opens (Done saves the alert), with its
 * Animation tab (the alert's looks, each looping), Customize tab (what the picked look takes), Sound tab and Location tab
 * (fixed spot or free drag, and the width, on the stage beside it); the sponsor images and the YouTube alerts
 * keep today's card editor in their Images and Design tabs (the page's legacy controls). The page-free
 * rules are window.ATLETA_BUILDER_STYLES
 * (public/js/builder-styles-core.js); the looks are drawn with the files the OBS overlay uses
 * (objects/kit.js and the joined family files), picked with the view's previewObjectFor().
 *
 * It reads what the view's inline script defines (src/views/overlay-builder.ejs): previewObjectFor,
 * ALERT_STYLES, SAVED_STYLES, SERVER_DESIGNS, SAVED_DESIGNS, STYLE_DATA, EVENT_DEFAULTS, PREVIEW_DATA, I18N,
 * sponsorImages, sponsorRotationEnabled, STREAMER_ID, currentType (set for the legacy controls), the legacy
 * card editor (workingDesigns, getControlValues, setControlValues, setCardPlace, updatePreview and the sponsor
 * functions), and window.BUILDER / window.BUILDER_TEXTS, so it is loaded after
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
    msg.textContent = '';
    return fetch('/dashboard/overlay/test/' + encodeURIComponent(type), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: false }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        msg.textContent = res.ok ? text('style.testSent') : (data.error || text('style.failed'));
      });
    }).catch(function () { msg.textContent = text('style.failed'); });
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
  function withoutRowColumns(design) {
    var out = copy(design);
    ROW_COLUMNS.forEach(function (column) { delete out[column]; });
    return out;
  }
  function draftOf(type) { return withoutRowColumns(designOf(type)); }
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
    if (isLegacy(type)) CARDS.draft = loadLegacy(type, CARDS.draft);
    CARDS.draftStyle = core().isStyled(type) ? shownStyleOf(type) : null;
    opened = { design: copy(CARDS.draft), style: CARDS.draftStyle };
    CARDS.tab = null;
    animFamily = 'all';
    soundFamily = 'all';
    soundQuery = '';

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
    if (type === 'timed') CARDS.renderCards();   // its images and rotation are saved as they change
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
    syncLegacyDraft();
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
    // A legacy card saves what the page's controls hold (its Design tab edits them, not the draft).
    var design = (isLegacy(type) && legacyValues()) || copy(CARDS.draft), style = CARDS.draftStyle;
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
          if (isLegacy(type)) CARDS.draft = loadLegacy(type, CARDS.draft);
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

  function lookById(id) {
    var styles = root.ATLETA_OBJECT_STYLES || {};
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(styles, id) ? styles[id] : null;
  }
  function familyOf(key) {
    return key ? (styleData().families || []).filter(function (f) { return f.key === key; })[0] || null : null;
  }
  function sampleOf(type) { return (typeof PREVIEW_DATA !== 'undefined' && PREVIEW_DATA[type]) || {}; }
  // An element with a class and, when given, its text.
  function make(tag, className, content) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  // The alert's icon and name, as a badge ("🏁 Follow").
  function alertBadge(type) { return make('span', 'ev-badge', (CARD_ICONS[type] || '') + ' ' + cardName(type)); }

  // ── The Animation tab ──
  // Theme chips ("All" and each family that has a look for this alert) and a gallery of this alert's looks
  // in the server's order (STYLE_CORE.orderGallery: made for the streamer, the default, the C1 with the
  // streamer's name, then the families), each tile looping its look. A tile plays only while it is on screen
  // (an IntersectionObserver on the window's scrolling pane), its first play 450 ms after its neighbour's, so
  // the gallery never pauses all at once; the tab's hide and the window's close stop them all.
  var animFamily = 'all';
  var galleryTiles = [];      // [{ id, tile, looper }]
  var galleryObserver = null;

  function galleryOf(type) {
    return core().orderGallery((styleData().gallery || {})[type], type, styleData().defaults);
  }
  function stopGallery() {
    galleryTiles.forEach(function (t) { t.looper.stop(); });
    galleryTiles = [];
    if (galleryObserver) galleryObserver.disconnect();
    galleryObserver = null;
  }
  // The picked tile plays with the window's own settings; the others in the streamer's colour, at normal speed.
  function tileDesign(id) {
    var draft = CARDS.draft || {};
    return id === CARDS.draftStyle ? draft : { style_accent: draft.style_accent, animation_speed: 1 };
  }
  function renderAnimation() {
    stopGallery();
    var type = CARDS.editing, chips = el('anim-chips'), box = el('anim-gallery');
    if (!type || !chips || !box) return;
    var entries = galleryOf(type);
    var families = (styleData().families || []).filter(function (f) { return entries.some(function (e) { return e.family === f.key; }); });
    if (animFamily !== 'all' && !families.some(function (f) { return f.key === animFamily; })) animFamily = 'all';

    chips.innerHTML = '';
    [{ key: 'all', name: text('style.all') }].concat(families).forEach(function (family) {
      var chip = make('button', 'anim-chip', family.name);
      chip.type = 'button';
      chip.setAttribute('data-family', family.key);
      chip.setAttribute('aria-pressed', String(animFamily === family.key));
      chip.addEventListener('click', function () { animFamily = family.key; renderAnimation(); });
      chips.appendChild(chip);
    });

    box.innerHTML = '';
    var scroller = root.document.querySelector ? root.document.querySelector('.ed-main') : null;
    if (root.IntersectionObserver) {
      galleryObserver = new root.IntersectionObserver(function (seen) {
        seen.forEach(function (entry) {
          var t = galleryTiles.filter(function (g) { return g.tile === entry.target; })[0];
          if (!t) return;
          if (entry.isIntersecting) t.looper.start();
          else t.looper.stop();
        });
      }, { root: scroller, rootMargin: '120px' });
    }
    core().filterGallery(entries, animFamily).forEach(function (entry) {
      var look = lookById(entry.id);
      if (!look || look.eventType !== type) return;   // its family's file did not load
      var index = galleryTiles.length;
      var tile = make('button', 'anim-tile');
      tile.type = 'button';
      tile.setAttribute('data-look', entry.id);
      tile.setAttribute('aria-pressed', String(entry.id === CARDS.draftStyle));
      var preview = make('div', 'anim-prev');
      preview.appendChild(make('div', 'stream-bg'));
      if (entry.badge) preview.appendChild(make('span', 'anim-badge', text(entry.badge === 'mine' ? 'style.mine' : 'style.default')));
      var slot = make('div', 'mini-slot');
      preview.appendChild(slot);
      var words = make('div', 'anim-txt');
      words.appendChild(make('div', 'anim-name', ((styleData().looks || {})[entry.id] || {}).title || entry.id));
      var family = familyOf(look.family);
      if (family) words.appendChild(make('div', 'anim-fam', family.name));
      words.appendChild(alertBadge(type));
      tile.appendChild(preview);
      tile.appendChild(words);
      tile.addEventListener('click', function () { pickLook(entry.id); });
      fitAlert(slot, look, 210);
      var looper = new Looper(slot, function () {
        return { look: look, design: tileDesign(entry.id), sample: sampleOf(type) };
      }, { hold: 1600, gap: 600, offset: (index % 6) * 450 });
      galleryTiles.push({ id: entry.id, tile: tile, looper: looper });
      box.appendChild(tile);
      if (galleryObserver) galleryObserver.observe(tile);
      else looper.start();
    });
  }

  // Picks one of this alert's looks: its settings start afresh (STYLE_CORE.withLook; where it sits, its
  // width and Racing's colours stay), the page shows it until the window closes, and its sound plays once.
  function pickLook(id) {
    var type = CARDS.editing, look = lookById(id);
    if (!type || !CARDS.draft || !look || look.key !== id || look.eventType !== type) return;
    var previous = CARDS.draftStyle;
    CARDS.draft = core().withLook(CARDS.draft, previous, id);
    CARDS.draftStyle = id;
    var shown = pageGlobal('ALERT_STYLES');
    if (shown) shown[type] = id;
    galleryTiles.forEach(function (t) {
      t.tile.setAttribute('aria-pressed', String(t.id === id));
      if ((t.id === id || t.id === previous) && t.looper.running) t.looper.restart();
    });
    renderTabValues();
    if (kit()) playLookSound(kit().soundFor(look, CARDS.draft));
  }

  // ── The Customize tab ──
  // What the picked look takes (STYLE_CORE.controlsFor), beside the look looping large (no stream): its
  // colour, or Racing's card, accent and name colours and font; its main text; its speed; its screen effect;
  // growing with the amount. A look with none of these (the C1s) says so. A change goes into the draft:
  // the colour applies at once (kit.slotVars), the others play the look again. "Use <theme> for all six
  // alerts" is the family route, at once, after a question.
  var customLooper = null;
  var fontsFilled = false;
  var ROWS = ['accent', 'racing', 'label', 'speed', 'effect', 'grows'];

  function customSlot() { return el('custom-slot'); }
  function fitCustom() {
    var slot = customSlot(), box = el('custom-preview'), look = draftLook();
    if (!slot || !look) return;
    var width = box && box.clientWidth ? box.clientWidth * 0.9 : 0;
    fitAlert(slot, look, width ? Math.round(Math.min(640, Math.max(280, width))) : LOOK_WIDTH);
  }
  function stopCustomize() { if (customLooper) customLooper.stop(); }
  function replayCustom() {
    if (!customLooper || CARDS.tab !== 'customize') return;
    fitCustom();
    customLooper.restart();
  }
  // The colour (and the speed) as slot variables, without playing the look again.
  function applyCustomVars() {
    var slot = customSlot(), look = draftLook(), K = kit();
    if (!slot || !look || !K || !look.family) return;
    var vars = K.slotVars(look, CARDS.draft);
    Object.keys(vars).forEach(function (name) { slot.style.setProperty(name, vars[name]); });
  }
  function setValue(id, value) {
    var node = el(id);
    if (node && node !== root.document.activeElement) node.value = value;
  }
  function syncCustomize() {
    var draft = CARDS.draft || {}, look = draftLook(), show = core().controlsFor(look);
    ROWS.forEach(function (row) { var node = el('custom-row-' + row); if (node) node.hidden = !show[row]; });
    var nothing = el('custom-nothing');
    if (nothing) {
      nothing.hidden = ROWS.some(function (row) { return show[row]; });
      nothing.textContent = text('custom.nothing');
    }
    setValue('style-accent', draft.style_accent || '#9146FF');
    var own = el('style-accent-own'), shownColour = el('style-accent-val');
    if (own) { own.hidden = !draft.style_accent; own.textContent = text('custom.ownColour'); }
    if (shownColour) shownColour.textContent = draft.style_accent || text('custom.ownColours');
    setValue('style-racing-card', draft.bg_color || '#1a1a3e');
    setValue('style-racing-accent', draft.accent_color || '#8888cc');
    setValue('style-racing-name', draft.username_color || draft.text_color || '#ffffff');
    setValue('style-racing-font', draft.username_font_family || 'System Default');
    setValue('style-label', (show.racing ? draft.event_label : draft.style_label) || '');
    var label = el('style-label');
    if (label) label.setAttribute('placeholder', text('style.labelHint'));
    var speed = core().speedOf(look, draft);
    setValue('style-speed', speed);
    var speedValue = el('val-style-speed');
    if (speedValue) speedValue.textContent = speed + '×';
    setValue('style-effect', draft.screen_effect || 'default');
    var grows = el('style-grows');
    if (grows) grows.checked = draft.style_grows !== 0;
    var family = look && look.family ? familyOf(look.family) : null;
    var allSix = el('custom-all-six');
    if (allSix) {
      allSix.hidden = !family;
      allSix.textContent = family ? text('custom.allSix', { family: family.name }) : '';
    }
  }
  function renderCustomize() {
    if (!CARDS.editing) return;
    syncCustomize();
    var slot = customSlot();
    if (!slot) return;
    if (!customLooper) {
      customLooper = new Looper(slot, function () {
        return { look: draftLook(), design: CARDS.draft || {}, sample: sampleOf(CARDS.editing) };
      }, { hold: 2200, gap: 700 });
    }
    fitCustom();
    customLooper.restart();
  }
  // One of the look's settings changed: into the draft, then the controls, the tab bar, and the preview
  // (`replay`: play the look again; otherwise only its slot variables change).
  function setSetting(field, value, replay) {
    if (!CARDS.editing || !CARDS.draft) return;
    CARDS.draft[field] = value;
    syncCustomize();
    renderTabValues();
    if (replay) replayCustom();
    else applyCustomVars();
  }
  function bindCustomize() {
    function on(id, type, fn) { var node = el(id); if (node) node.addEventListener(type, fn); }
    var fonts = el('style-racing-font');
    if (fonts && !fontsFilled) {
      fontsFilled = true;
      (styleData().fonts || []).forEach(function (font) {
        var option = make('option', null, font === 'System Default' ? text('style.fontOwn') : font);
        option.value = font;
        fonts.appendChild(option);
      });
    }
    on('style-accent', 'input', function (e) { setSetting('style_accent', String(e.target.value).toUpperCase()); });
    on('style-accent-own', 'click', function () { setSetting('style_accent', null); });
    on('style-racing-card', 'input', function (e) { setSetting('bg_color', e.target.value); });
    on('style-racing-accent', 'input', function (e) { setSetting('accent_color', e.target.value); });
    on('style-racing-name', 'input', function (e) { setSetting('username_color', e.target.value); });
    ['style-racing-card', 'style-racing-accent', 'style-racing-name'].forEach(function (id) { on(id, 'change', replayCustom); });
    on('style-racing-font', 'change', function (e) { setSetting('username_font_family', e.target.value === 'System Default' ? null : e.target.value, true); });
    // Racing's main text is today's event_label; the other looks' is their own style_label.
    on('style-label', 'input', function (e) {
      setSetting(core().controlsFor(draftLook()).racing ? 'event_label' : 'style_label', e.target.value);
    });
    on('style-label', 'change', replayCustom);
    on('style-speed', 'input', function (e) { setSetting('animation_speed', parseFloat(e.target.value)); });
    on('style-speed', 'change', replayCustom);
    on('style-effect', 'change', function (e) { setSetting('screen_effect', e.target.value, true); });
    on('style-grows', 'change', function (e) { setSetting('style_grows', e.target.checked ? 1 : 0, true); });
    on('custom-all-six', 'click', function () { useFamily(); });
    var box = el('custom-preview');
    if (box && root.ResizeObserver) new root.ResizeObserver(function () { if (CARDS.tab === 'customize') fitCustom(); }).observe(box);
  }

  // "Use <theme> for all six alerts": the picked look's family, stored at once for the six alerts (one
  // transaction on the server), after a question naming it. Every stored row is taken as the page's, and the
  // cards are drawn again; the open alert takes the stored look and its settings and keeps what was edited
  // and not saved (STYLE_CORE.lookApplied). The window stays open on the new look.
  var familyBusy = false;
  function useFamily() {
    var type = CARDS.editing, look = draftLook();
    var family = look && look.family ? familyOf(look.family) : null;
    if (!type || !family || saving || familyBusy) return Promise.resolve({ ok: false });
    if (!root.confirm(text('custom.allSixConfirm', { family: family.name }))) return Promise.resolve({ ok: false });
    var button = el('custom-all-six');
    familyBusy = true;
    if (button) button.disabled = true;
    showMessage('');
    function finish(result) {
      familyBusy = false;
      if (button) button.disabled = false;
      return result;
    }
    return fetch('/dashboard/overlay-builder/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family: family.key }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.ok || !data.designs) {
          showMessage((data && data.error) || text('style.failed'), true);
          return finish({ ok: false });
        }
        var saved = pageGlobal('SAVED_STYLES') || {}, shown = pageGlobal('ALERT_STYLES') || {};
        var defaults = typeof EVENT_DEFAULTS !== 'undefined' ? EVENT_DEFAULTS : {};
        Object.keys(data.designs).forEach(function (alert) {
          var row = data.designs[alert];
          if (!row || !row.style) return;
          storeRow(alert, row);
          saved[alert] = shown[alert] = row.style;
          if (alert !== CARDS.editing) return;
          var stored = Object.assign({}, defaults[alert] || {}, row);
          CARDS.draft = withoutRowColumns(core().lookApplied(CARDS.draft, stored));
          CARDS.draftStyle = row.style;
          if (opened) opened = { design: withoutRowColumns(core().lookApplied(opened.design, stored)), style: row.style };
        });
        finish(null);
        CARDS.renderCards();
        if (CARDS.editing === type) {
          showMessage(text('style.familyDone', { family: family.name }));
          renderTabValues();
          if (CARDS.tab) paneHook(CARDS.tab, 'show');
        }
        return { ok: true };
      });
    }).catch(function () {
      showMessage(text('style.failed'), true);
      return finish({ ok: false });
    });
  }

  // ── The Sound tab ──
  // A search box, theme chips, then "This look" (its own sound, its version 2, the classic engine sound, no
  // sound, and a saved sound of another alert as "Current": STYLE_CORE.thisLookRows) and only this alert's
  // sounds by theme (STYLE_CORE.soundGroupsFor). Each row has a ▶ that listens without picking and a button
  // that picks (the look's own sound is stored as null) and plays; its second line names the alert and the
  // look the sound was made for. No stage. A sound the streamer uploaded for the alert wins in OBS: a notice.
  var soundFamily = 'all';
  var soundQuery = '';
  var soundBox = null;        // where the groups are drawn
  var soundRows = [];         // [{ key, pick }] of the groups drawn, to mark the one in use

  function soundNameOf(key) {
    if (key === 'today') return text('sound.today');
    if (key === 'none') return text('sound.none');
    var groups = styleData().sounds || [];
    for (var i = 0; i < groups.length; i++) {
      for (var j = 0; j < groups[i].sounds.length; j++) if (groups[i].sounds[j].key === key) return groups[i].sounds[j].name;
    }
    return key;
  }
  function soundOwners() { return core().soundOwners(root.ATLETA_OBJECT_STYLES || {}); }
  // The second line's words after the look: the engine sound needs none, its name says it.
  var SOUND_TAGS = { own: 'sound.own', second: 'sound.second', none: 'sound.silent', current: 'sound.current' };

  function soundRow(key, tag, owners, current) {
    var owner = core().ownerOfSound(key, owners);
    var row = make('div', 'snd');
    row.setAttribute('data-key', key);
    var play = make('button', 'play', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', text('sound.listen'));
    play.setAttribute('title', text('sound.listen'));
    play.addEventListener('click', function () {
      play.classList.add('on');
      setTimeout(function () { play.classList.remove('on'); }, 1500);
      playLookSound(key);
    });
    var pick = make('button', 'snd-pick');
    pick.type = 'button';
    pick.setAttribute('aria-pressed', String(current === key));
    var name = make('span', 'snd-name', soundNameOf(key));
    name.setAttribute('title', soundNameOf(key));
    pick.appendChild(name);
    var words = [owner && ((styleData().looks || {})[owner.look.key] || {}).title || (owner && owner.look.key), SOUND_TAGS[tag] && text(SOUND_TAGS[tag])].filter(Boolean).join(' · ');
    if (owner || words) {
      var line = make('span', 'snd-tag' + (tag === 'own' ? ' own' : ''));
      if (owner) line.appendChild(alertBadge(owner.eventType));
      var label = make('span', 'tag-txt', words);
      label.setAttribute('title', words);
      line.appendChild(label);
      pick.appendChild(line);
    }
    pick.addEventListener('click', function () { pickSound(key); });
    row.appendChild(play);
    row.appendChild(pick);
    soundRows.push({ key: key, pick: pick });
    return row;
  }
  function soundGroup(title, note, rows) {
    var group = make('div', 'snd-group');
    var head = make('h4', 'snd-head', title);
    if (note) head.appendChild(make('small', null, note));
    group.appendChild(head);
    var list = make('div', 'snd-list');
    rows.forEach(function (r) { list.appendChild(r); });
    group.appendChild(list);
    return group;
  }
  function renderSoundList() {
    var type = CARDS.editing, look = draftLook();
    if (!soundBox || !type || !CARDS.draft) return;
    soundBox.innerHTML = '';
    soundRows = [];
    var owners = soundOwners(), all = styleData().sounds || [];
    var alertGroups = core().soundGroupsFor(type, all, owners);
    var current = kit() ? kit().soundFor(look, CARDS.draft) : null;
    var query = soundQuery.trim().toLowerCase();
    function shown(key) { return !query || soundNameOf(key).toLowerCase().indexOf(query) >= 0; }

    var mine = core().thisLookRows(look, CARDS.draft.style_sound, all, alertGroups).filter(function (r) { return shown(r.key); });
    if (mine.length) {
      soundBox.appendChild(soundGroup(text('sound.thisLook'), '', mine.map(function (r) { return soundRow(r.key, r.tag, owners, current); })));
    }
    alertGroups.forEach(function (g) {
      if (soundFamily !== 'all' && g.family !== soundFamily) return;
      var sounds = g.sounds.filter(function (s) { return shown(s.key); });
      if (!sounds.length) return;
      var family = familyOf(g.family);
      soundBox.appendChild(soundGroup(family ? family.name : g.family, g.sounds.length === 2 ? text('sound.both') : '',
        sounds.map(function (s) { return soundRow(s.key, look && s.key === look.sound ? 'own' : '', owners, current); })));
    });
  }
  function markSound() {
    var look = draftLook(), current = kit() && CARDS.draft ? kit().soundFor(look, CARDS.draft) : null;
    soundRows.forEach(function (r) { r.pick.setAttribute('aria-pressed', String(r.key === current)); });
  }

  function renderSound() {
    var pane = el('pane-sound'), type = CARDS.editing;
    if (!pane || !type || !CARDS.draft) return;
    pane.innerHTML = '';
    if ((builder().uploadedSounds || {})[type]) {
      var notice = make('p', 'snd-notice', text('sound.uploaded') + ' ');
      var link = make('a', null, text('sound.uploadedLink'));
      link.setAttribute('href', '/dashboard/overlay');
      notice.appendChild(link);
      pane.appendChild(notice);
    }
    var search = make('input', 'snd-search');
    search.type = 'search';
    search.value = soundQuery;
    search.setAttribute('placeholder', text('sound.search'));
    search.setAttribute('aria-label', text('sound.search'));
    search.addEventListener('input', function (e) { soundQuery = String(e.target.value || ''); renderSoundList(); });
    pane.appendChild(search);

    var owners = soundOwners();
    var families = core().soundGroupsFor(type, styleData().sounds || [], owners).map(function (g) { return g.family; });
    if (soundFamily !== 'all' && families.indexOf(soundFamily) < 0) soundFamily = 'all';
    var chips = make('div', 'anim-chips');
    ['all'].concat(families).forEach(function (key) {
      var family = familyOf(key);
      var chip = make('button', 'anim-chip', key === 'all' ? text('style.all') : (family ? family.name : key));
      chip.type = 'button';
      chip.setAttribute('data-family', key);
      chip.setAttribute('aria-pressed', String(soundFamily === key));
      chip.addEventListener('click', function () { soundFamily = key; renderSound(); });
      chips.appendChild(chip);
    });
    pane.appendChild(chips);
    soundBox = make('div', 'snd-groups');
    pane.appendChild(soundBox);
    renderSoundList();
  }

  // Picks a sound for the draft (the look's own is stored as null: it follows the look), and plays it.
  function pickSound(key) {
    var look = draftLook();
    if (!CARDS.editing || !CARDS.draft) return;
    CARDS.draft.style_sound = look && key === look.sound ? null : key;
    markSound();
    renderTabValues();
    playLookSound(key);
  }

  // ── The legacy cards: the sponsor images, and the YouTube alerts while YouTube is on ──
  // They keep today's card editor, which the page owns (src/views/overlay-builder.ejs): the controls of the Images
  // and Design tabs, read by getControlValues() and set by setControlValues(), the theme, text and animation pop-ups,
  // and the card updatePreview() draws (#preview-card in #preview-card-container, which waits in #legacy-preview
  // while no stage shows it). The window loads the card's design into those controls when it opens or is reset,
  // the Location tab hands them where the card sits (setCardPlace), and Done saves what getControlValues() reads.
  // Without the page's code (the other tabs' tests) the draft stays as draftOf() made it.
  function isLegacy(type) { return !!type && !core().isStyled(type) && core().tabsFor(type).length > 0; }
  function pageFn(name) { return root && typeof root[name] === 'function' ? root[name] : null; }
  function callPage(name, arg) {
    var fn = pageFn(name);
    if (!fn) return undefined;
    try { return fn(arg); } catch (e) { if (root.console) root.console.error(e); return undefined; }
  }
  // What the page's controls hold now, as the save sends it (null without the page's legacy code).
  function legacyValues() {
    var values = callPage('getControlValues');
    return values ? copy(values) : null;
  }
  // Puts a design into the page's controls; the page's working copy starts again from it, so a cancelled window
  // leaves nothing behind. Returns what the controls then hold: the window's draft.
  function loadLegacy(type, design) {
    if (!pageFn('setControlValues') || !pageFn('getControlValues')) return design;
    if (typeof workingDesigns !== 'undefined' && workingDesigns) workingDesigns[type] = copy(design);
    callPage('setControlValues', design);
    ['updateSideIconGrid', 'updateTextSectionPreview', 'updateAnimSectionPreview'].forEach(function (name) { callPage(name, design); });
    return legacyValues() || design;
  }
  // The draft follows the page's controls (the Design tab and its pop-ups edit those, not the draft).
  function syncLegacyDraft() {
    if (!isLegacy(CARDS.editing) || !CARDS.draft) return;
    var values = legacyValues();
    if (values) Object.assign(CARDS.draft, values);
  }
  // Where the card sits, as the Location tab sets it, goes to the page's controls too.
  function pushPlace() {
    if (!isLegacy(CARDS.editing) || !CARDS.draft) return;
    var d = CARDS.draft;
    callPage('setCardPlace', {
      card_position: d.card_position, card_width: d.card_width,
      card_custom_x: d.card_custom_x == null ? null : d.card_custom_x, card_custom_y: d.card_custom_y == null ? null : d.card_custom_y,
    });
  }
  // The Images tab: today's sponsor controls, each saving through its route at once.
  function showImages() {
    callPage('renderSponsorList');
    var toggle = el('sp-rotation-toggle');
    if (toggle && typeof sponsorRotationEnabled !== 'undefined') toggle.checked = !!sponsorRotationEnabled;
  }
  function hideImages() { callPage('stopSponsorPreview'); }

  // ── The stage ──
  // The wide stream preview beside the Location and Design tabs: a 1920x1080 screen (#stage-inner, scaled to
  // the column by a ResizeObserver) with the alert in #stage-slot, laid out by placement.js as OBS lays it out,
  // looping with its screen effect. What the slot plays comes from CARDS.stageContent(): { look, design, sample }
  // for an alert's look, or { element, home } for a legacy card, the page's own card, which the slot shows as the
  // page draws it (no loop) and gives back to `home` when the stage stops. The loop runs only while the tab that
  // shows the stage is open: stopStage() empties the slot and removes the particles.
  var stageLooper = null;
  var mounted = null;           // { node, home }: the page's card while the slot shows it
  var stageHeight = 0;          // the slot's last measured height on the 1920 stage, for when it is empty between loops
  var stageForceSound = false;  // Replay: the next play makes its sound

  function stageSlot() { return el('stage-slot'); }
  function stageScale() {
    var stage = el('stage');
    return stage && stage.clientWidth > 0 ? stage.clientWidth / 1920 : 1;
  }
  function clearStageFx() {
    var layer = el('fx-layer'), stage = el('stage');
    if (layer) layer.innerHTML = '';
    // The page's older effects (confetti, gold, money, robots, tire marks) are children of the stage itself.
    if (stage && stage.querySelectorAll) Array.prototype.forEach.call(stage.querySelectorAll('.preview-fx'), function (n) { n.remove(); });
  }
  // The look's screen effect: the five of fx.js are drawn on the 1920 layer as OBS draws them; the older ones
  // by the page's renderScreenEffect, on the stage and with the draft's amount, size and direction.
  function stageEffect(look, design) {
    clearStageFx();
    var K = kit();
    if (!K || !look) return;
    var effect = K.effectFor(look, design);
    if (!effect || effect === 'none') return;
    if (root.ATLETA_FX && root.ATLETA_FX.KINDS.indexOf(effect) >= 0) root.ATLETA_FX.spawn(el('fx-layer'), effect, { scale: 1 });
    else if (typeof renderScreenEffect === 'function') renderScreenEffect(effect, { screen: el('stage'), design: design, type: CARDS.editing });
  }
  function stageOnPlay(look, design) {
    var slot = stageSlot();
    if (slot && slot.offsetHeight) stageHeight = slot.offsetHeight;
    stageEffect(look, design);
    var every = el('stage-sound-loop');
    var withSound = stageForceSound || !!(every && every.checked);
    stageForceSound = false;
    // A sound the streamer uploaded wins in OBS (overlay settings): the look's would only mislead.
    if (withSound && kit() && !(builder().uploadedSounds || {})[CARDS.editing]) playLookSound(kit().soundFor(look, design));
  }
  function stageLoop() {
    var slot = stageSlot();
    if (!stageLooper && slot) {
      stageLooper = new Looper(slot, function () { return CARDS.stageContent(); }, { hold: 2400, gap: 800, onPlay: stageOnPlay });
    }
    return stageLooper;
  }
  // Puts the slot where the draft says, as OBS does (placement.js): the inline edges, the width, and a look drawn
  // for 420 px scaled to it (--zw; today's objects and the legacy cards reflow instead).
  function placeStage() {
    var slot = stageSlot(), P = root.ATLETA_PLACEMENT;
    if (!slot || !P || !CARDS.draft) return;
    var look = CARDS.stageContent().look, placement = P.placementOf(CARDS.draft), style = P.slotStyle(placement);
    Object.keys(style).forEach(function (name) { slot.style[name] = style[name]; });
    slot.classList.toggle('look', !!(look && look.family && !look.preset));
    slot.style.setProperty('--zw', String(placement.width / LOOK_WIDTH));
    slot.style.setProperty('--fw', '1920px');
  }
  function mountStage(content) {
    var slot = stageSlot();
    if (!slot) return;
    unmountStage();
    if (stageLooper) stageLooper.stop();   // a look an alert's window left in the slot
    mounted = { node: content.element, home: content.home || null };
    slot.appendChild(content.element);
  }
  function unmountStage() {
    if (!mounted) return;
    if (mounted.home) mounted.home.appendChild(mounted.node);
    mounted = null;
  }
  function startStage() {
    var content = CARDS.stageContent();
    if (content && content.element) {
      mountStage(content);
      placeStage();
      // The page draws its card, with its screen effect on the stage (and the sponsor image that rotates in its place).
      callPage('updatePreview');
      if (CARDS.editing === 'timed') callPage('updateSponsorPreview');
      return;
    }
    var loop = stageLoop();
    if (!loop) return;
    placeStage();
    loop.restart();
  }
  function stopStage() {
    if (mounted) {
      unmountStage();
      if (CARDS.editing === 'timed') callPage('stopSponsorPreview');
    }
    if (stageLooper) stageLooper.stop();
    clearStageFx();
    var stage = el('stage');
    if (stage) stage.classList.remove('dragging-on');
    drag = null;
  }
  function replayStage() {
    var content = CARDS.stageContent();
    if (content && content.element) { callPage('playPreviewAnimation'); return; }   // a legacy card: its entrance
    stageForceSound = true;
    var loop = stageLoop();
    if (loop && loop.running) loop.restart();
  }

  // ── The Location tab ──
  // Fixed spot (one of nine, 16 px from the edges) or free position (dragged on the stage, stored as fractions of
  // the screen), and the width. Switching to free starts where the alert sits now; a spot clears the free position.
  var locRefs = null;       // the controls of the tab, to mark the state
  var drag = null;          // { k, dx, dy }: the stage's scale and where in the alert the pointer took hold

  function isFree() { return !!CARDS.draft && core().placeSummary(CARDS.draft).free; }
  function slotSize() {
    var slot = stageSlot(), P = root.ATLETA_PLACEMENT;
    return {
      w: (slot && slot.offsetWidth) || P.placementOf(CARDS.draft).width,
      h: (slot && slot.offsetHeight) || stageHeight || 0,
    };
  }
  // The fractions of the screen the alert's top-left corner is at now (a fixed spot's), kept on the stage.
  function cornerNow() {
    var P = root.ATLETA_PLACEMENT, placement = P.placementOf(CARDS.draft), size = slotSize();
    var x = placement.horizontal === 'left' ? P.MARGIN : placement.horizontal === 'right' ? 1920 - P.MARGIN - size.w : (1920 - size.w) / 2;
    var y = placement.vertical === 'top' ? P.MARGIN : placement.vertical === 'bot' ? 1080 - P.MARGIN - size.h : (1080 - size.h) / 2;
    return core().clampFree(x, y, size.w, size.h);
  }
  function syncLocation() {
    if (!locRefs || !CARDS.draft) return;
    var place = core().placeSummary(CARDS.draft), width = root.ATLETA_PLACEMENT.placementOf(CARDS.draft).width;
    locRefs.fixed.setAttribute('aria-pressed', String(!place.free));
    locRefs.free.setAttribute('aria-pressed', String(place.free));
    locRefs.cells.forEach(function (cell, i) { cell.setAttribute('aria-pressed', String(!place.free && place.cell === i)); });
    locRefs.grid.classList.toggle('off', place.free);
    locRefs.note.textContent = text(place.free ? 'place.freeNote' : 'place.fixedNote');
    locRefs.widthValue.textContent = text('place.width', { px: width });
    if (locRefs.width !== (root.document && root.document.activeElement)) locRefs.width.value = String(width);
    var stage = el('stage');
    if (stage) stage.classList.toggle('dragging-on', place.free && CARDS.tab === 'location');
  }
  // A change to where the alert sits: into the draft, then the controls, the stage and the tab bar.
  function setPlace(changes) {
    if (!CARDS.editing || !CARDS.draft) return;
    Object.assign(CARDS.draft, changes);
    pushPlace();
    syncLocation();
    placeStage();
    renderTabValues();
  }
  function renderLocation() {
    var pane = el('pane-location'), P = root.ATLETA_PLACEMENT;
    if (!pane || !P || !CARDS.editing || !CARDS.draft) return;
    pane.innerHTML = '';
    var refs = { cells: [] };

    var modes = make('div', 'loc-mode');
    [['fixed', 'place.fixed', 'place.fixedHint'], ['free', 'place.free', 'place.freeHint']].forEach(function (m) {
      var button = make('button');
      button.type = 'button';
      button.setAttribute('data-mode', m[0]);
      button.appendChild(make('b', null, text(m[1])));
      button.appendChild(make('small', null, text(m[2])));
      button.addEventListener('click', function () {
        if (m[0] === 'free') {
          if (isFree()) return;
          var at = cornerNow();   // starts where the alert sits now
          setPlace({ card_custom_x: at.x, card_custom_y: at.y });
        } else {
          if (!isFree()) return;
          setPlace({ card_custom_x: null, card_custom_y: null });
        }
      });
      modes.appendChild(button);
      refs[m[0]] = button;
    });
    pane.appendChild(modes);

    var grid = make('div', 'loc-grid');
    grid.setAttribute('role', 'group');
    POSITIONS.forEach(function (pos) {
      var parts = pos.split('-');
      var cell = make('button', 'loc-cell');
      cell.type = 'button';
      cell.setAttribute('data-pos', pos);
      cell.setAttribute('aria-label', text('place.' + parts[0]) + ' ' + text('place.' + parts[1]));
      cell.appendChild(make('span'));
      cell.addEventListener('click', function () { setPlace({ card_position: pos, card_custom_x: null, card_custom_y: null }); });
      grid.appendChild(cell);
      refs.cells.push(cell);
    });
    pane.appendChild(grid);
    refs.grid = grid;
    refs.note = make('p', 'loc-note');
    pane.appendChild(refs.note);

    var field = make('div', 'cz-field');
    var label = make('label', 'cz-lbl');
    label.setAttribute('for', 'loc-width');
    label.appendChild(make('span', null, text('place.size')));
    refs.widthValue = make('span');
    label.appendChild(refs.widthValue);
    var range = make('input');
    range.type = 'range';
    range.id = 'loc-width';
    range.setAttribute('min', String(P.MIN_WIDTH));
    range.setAttribute('max', String(P.MAX_WIDTH));
    range.setAttribute('step', '10');
    range.addEventListener('input', function (e) { setPlace({ card_width: Number(e.target.value) }); });
    field.appendChild(label);
    field.appendChild(range);
    pane.appendChild(field);
    refs.width = range;

    locRefs = refs;
    syncLocation();
  }
  function showLocation() {
    renderLocation();
    startStage();
    syncLocation();
  }
  function hideLocation() {
    stopStage();
    locRefs = null;
  }

  // Dragging the alert on the stage (free position only): the pointer is captured, the corner follows it kept on
  // the screen (STYLE_CORE.clampFree) and the draft stores fractions.
  function dragStart(e) {
    var stage = el('stage');
    if (CARDS.tab !== 'location' || !isFree() || !stage) return;
    var k = stageScale(), box = stage.getBoundingClientRect(), custom = root.ATLETA_PLACEMENT.placementOf(CARDS.draft).custom;
    drag = { k: k, dx: (e.clientX - box.left) / k - custom.x * 1920, dy: (e.clientY - box.top) / k - custom.y * 1080 };
    var slot = stageSlot();
    if (slot && slot.setPointerCapture) { try { slot.setPointerCapture(e.pointerId); } catch (err) { /* no pointer to capture (a synthetic event) */ } }
    if (e.preventDefault) e.preventDefault();
  }
  function dragMove(e) {
    var stage = el('stage');
    if (!drag || !stage || !CARDS.draft) return;
    var box = stage.getBoundingClientRect(), size = slotSize();
    var at = core().clampFree((e.clientX - box.left) / drag.k - drag.dx, (e.clientY - box.top) / drag.k - drag.dy, size.w, size.h);
    CARDS.draft.card_custom_x = at.x;
    CARDS.draft.card_custom_y = at.y;
    pushPlace();
    placeStage();
  }
  function dragEnd() {
    if (!drag) return;
    drag = null;
    renderTabValues();
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
      if (e.key !== 'Escape' || !CARDS.editing) return;
      e.preventDefault();
      // One of the page's pop-ups (the Design tab's theme, text and animation editors) is over the window: Esc
      // closes that one alone, as its Cancel does.
      var popup = doc.querySelector ? doc.querySelector('.modal-overlay.visible') : null;
      if (popup) { popup.classList.remove('visible'); return; }
      closeEditor();
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
    on('stage-replay', function () { replayStage(); });
    var slot = stageSlot();
    if (slot) {
      slot.addEventListener('pointerdown', dragStart);
      slot.addEventListener('pointermove', dragMove);
      slot.addEventListener('pointerup', dragEnd);
      slot.addEventListener('pointercancel', dragEnd);
    }
    bindCustomize();
  }

  var CARDS = {
    Looper: Looper, fitAlert: fitAlert, designOf: designOf, shownCards: shownCards, renderCards: renderCards,
    CARD_ICONS: CARD_ICONS, watch: watch,
    // The edit window (the cards call CARDS.openEditor, late-bound)
    openEditor: openEditor, closeEditor: closeEditor, setTab: setTab, saveDraft: saveDraft, resetDraft: resetDraft,
    isDirty: isDirty, tabValue: tabValue, renderTabValues: renderTabValues, draftLook: draftLook, openFromUrl: openFromUrl,
    // The Animation and Customize tabs
    renderAnimation: renderAnimation, renderCustomize: renderCustomize, pickLook: pickLook, useFamily: useFamily,
    // The Sound tab
    renderSound: renderSound, pickSound: pickSound,
    // The Location tab and the stage beside it (stageContent is what the stage plays: the alert's look, or a legacy
    // card's own element, drawn by the page)
    renderLocation: renderLocation, placeStage: placeStage,
    stageContent: function () {
      if (isLegacy(CARDS.editing)) return { element: el('preview-card-container'), home: el('legacy-preview'), design: CARDS.draft || {} };
      return { look: draftLook(), design: CARDS.draft || {}, sample: sampleOf(CARDS.editing) };
    },
    editing: null, draft: null, draftStyle: null, tab: null,
    panes: {
      animation: { show: renderAnimation, hide: stopGallery },
      customize: { show: renderCustomize, hide: stopCustomize },
      sound: { show: renderSound },
      location: { show: showLocation, hide: hideLocation },
      // The legacy cards' tabs (the page's own controls)
      images: { show: showImages, hide: hideImages },
      design: { show: startStage, hide: stopStage },
    },
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
