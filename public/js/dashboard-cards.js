'use strict';

// The dashboard's working cards (views/cards/*.ejs). Every switch and select saves the moment it changes
// (POST /dashboard/settings) and the cards' status lines follow (GET /dashboard/api/cards); the copy, show-link,
// show-all and packing work here too, and the pop-up editors, the test buttons, the rewards, the moderator check and
// the giveaway panel below them. Texts: window.ATLETA_CARD_TEXTS (dashboard.ejs). Helpers: window.ATLETA_CARDS
// (dashboard-cards-core.js). Served as it is (no build step).
(function () {
  const core = window.ATLETA_CARDS;
  const T = window.ATLETA_CARD_TEXTS || {};
  const grid = document.getElementById('wc-grid');
  if (!core || !grid) return;
  const live = document.getElementById('wc-live');
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector));

  // ── The server ──

  // A JSON request (public/js/csrf.js adds the CSRF header); its answer as readAnswer() reads it. A redirect is not
  // followed: the redirect to sign in leads off the site (to Discord), where fetch can only fail, so it comes back as
  // an opaque redirect, which readAnswer() takes for a session that ended. A request that is not answered in 20 s
  // counts as no network, so a control's queue is never kept busy for good.
  async function call(method, url, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const options = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', redirect: 'manual' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) options.signal = AbortSignal.timeout(20000);
    try {
      const response = await fetch(url, options);
      return await core.readAnswer(response);
    } catch (e) {
      return { ok: false, kind: 'network' };
    }
  }

  // ── What a card says back ──

  function announce(text) {
    if (!live || !text) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 50);
  }
  function showSaved(card) {
    const saved = card && $('[data-saved]', card);
    if (saved) {
      saved.classList.add('show');
      clearTimeout(saved.hideTimer);
      saved.hideTimer = setTimeout(() => saved.classList.remove('show'), 1600);
    }
    announce(T.saved);
  }
  // The words for an answer that did not go through (a server error's own text is English: not shown).
  function messageFor(answer) {
    if (answer.kind === 'session') return T.sessionEnded;
    if (answer.kind === 'network') return T.network;
    if (answer.kind === 'refused') return answer.error || T.failed;
    return (answer.status !== 500 && answer.error) || T.failed;
  }
  // A card's message line, or a pop-up's (box): an answer's words, or a text; for a refusal that asks for a step
  // (no_channel, no_role, no_email), the link to the page that sets it.
  function showMessage(card, answer, { fixHref, box, info } = {}) {
    const target = box || (card && $('[data-msg]', card));
    if (!target) return;
    target.textContent = typeof answer === 'string' ? answer : messageFor(answer);
    target.classList.toggle('info', !!info);
    if (fixHref && answer && typeof answer === 'object' && /^no_(channel|role|email)$/.test(answer.code || '')) {
      const link = document.createElement('a');
      link.href = fixHref;
      link.textContent = T.fixIt;
      target.append(' ', link);
    }
    target.hidden = false;
    announce(target.textContent);
    repack();
  }
  function clearMessage(card) {
    const box = card && $('[data-msg]', card);
    if (box && !box.hidden) {
      box.hidden = true;
      box.textContent = '';
      repack();
    }
  }

  // ── The status lines ──

  // After a change, the cards' status lines and counts as the server sees them now: one request for a burst.
  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 400);
  }
  async function refresh() {
    const answer = await call('GET', '/dashboard/api/cards');
    if (!answer.ok || !answer.data || !answer.data.cards) return;
    for (const [name, texts] of Object.entries(answer.data.cards)) {
      const card = document.getElementById('card-' + name);
      if (!card) continue;
      const status = $('[data-status]', card);
      if (status && texts.status) {
        status.textContent = texts.status.text;
        status.className = 'wc-status' + (texts.status.tone === 'ok' ? '' : ' ' + texts.status.tone);
      }
      for (const [count, text] of Object.entries(texts.counts || {})) {
        const el = $('[data-count="' + count + '"]', card);
        if (el) el.textContent = text;
      }
    }
  }

  // ── Switches, selects and the volume ──

  function valueOf(control) {
    if (control.type === 'checkbox') return control.checked;
    const n = Number(control.value);
    return control.dataset.scale ? n / Number(control.dataset.scale) : n;
  }
  function setValue(control, value) {
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = String(control.dataset.scale ? Math.round(value * Number(control.dataset.scale)) : value);
    reflect(control);
  }
  // What a control's state changes around it: its row or tile, what fades with a card's main switch, the cards that
  // need the chatbot, the volume's percent.
  function reflect(control) {
    if (control.type === 'checkbox') {
      const on = control.checked;
      const row = control.closest('.wc-row');
      if (row) row.classList.toggle('is-off', !on);
      const tile = control.closest('.wc-sw');
      if (tile) tile.classList.toggle('is-on', on);
      const key = control.dataset.setting;
      if (key && !control.dataset.guildId && !control.dataset.id) {
        $$('[data-dim-with="' + key + '"]').forEach((el) => el.classList.toggle('wc-dim', !on));
        if (key === 'chatbot_enabled') $$('[data-needs-chatbot]').forEach((card) => card.classList.toggle('needs-bot', !on));
      }
    } else if (control.type === 'range') {
      const label = $('[data-volume-label]', control.parentNode);
      if (label) label.textContent = control.value + '%';
    }
  }
  function settingBody(control, value) {
    const body = { key: control.dataset.setting, value };
    if (control.dataset.guildId) body.guildId = control.dataset.guildId;
    if (control.dataset.id) body.id = Number(control.dataset.id);
    return body;
  }
  // Each control saves through its own queue: the newest value wins; a refused one goes back to what the server
  // holds, with the reason (and the page that fixes it) on the card.
  const queues = new WeakMap();
  function queueFor(control) {
    if (!queues.has(control)) {
      queues.set(control, core.createLatestQueue((value) => call('POST', '/dashboard/settings', settingBody(control, value)), {
        confirmed: valueOf(control),
        onDone(answer, held) {
          const card = control.closest('.wc-card');
          if (answer && answer.ok) {
            clearMessage(card);
            showSaved(card);
            refreshSoon();
            return;
          }
          setValue(control, held);
          showMessage(card, answer || { ok: false, kind: 'failed' }, { fixHref: control.dataset.fixHref });
        },
      }));
    }
    return queues.get(control);
  }
  grid.addEventListener('change', (event) => {
    const control = event.target.closest('[data-setting]');
    if (!control || !grid.contains(control)) return;
    reflect(control);
    queueFor(control).push(valueOf(control));
  });
  grid.addEventListener('input', (event) => {
    if (event.target.type === 'range' && event.target.dataset.setting) reflect(event.target);
  });

  // ── Clicks: the first handler that knows the element takes it ──

  const clickHandlers = [];
  function onClick(selector, handle) {
    clickHandlers.push((event) => {
      const el = event.target.closest(selector);
      if (!el || !grid.contains(el)) return false;
      handle(el, event);
      return true;
    });
  }
  grid.addEventListener('click', (event) => {
    for (const handle of clickHandlers) if (handle(event)) return;
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (e2) { done = false; }
      area.remove();
      return done;
    }
  }
  onClick('[data-copy]', async (button) => {
    const done = await copyText(button.dataset.copy);
    const label = $('[data-copy-label]', button);
    if (!label) return;
    label.textContent = done ? T.copied : T.copyFailed;
    announce(label.textContent);
    setTimeout(() => { label.textContent = T.copy; }, 1500);
  });
  // The OBS link stays masked until the eye is clicked: anyone with it can show alerts.
  onClick('[data-reveal]', (button) => {
    const link = $('.wc-link', button.parentNode);
    if (!link) return;
    const shown = button.getAttribute('aria-pressed') === 'true';
    link.textContent = shown ? link.dataset.masked : link.dataset.shown;
    button.setAttribute('aria-pressed', String(!shown));
  });
  onClick('[data-show-all]', (button) => {
    const list = document.getElementById(button.dataset.showAll);
    if (!list) return;
    const open = !list.classList.contains('show-all');
    list.classList.toggle('show-all', open);
    button.textContent = open ? T.showFewer : core.fill(T.showAll, { count: $$('[data-row]', list).length });
    repack();
  });
  onClick('[data-open-tab]', (link, event) => {
    const tab = document.querySelector('.tab-btn[data-tab="' + link.dataset.openTab + '"]');
    if (!tab) return;
    event.preventDefault();
    tab.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Packing: each card spans its own height, so the next card fills the shorter column ──

  let observer = null;
  function repack() {
    if (!grid.classList.contains('packed')) return;
    for (const card of $$('.wc-card', grid)) card.style.gridRowEnd = 'span ' + core.rowSpan(card.getBoundingClientRect().height);
  }

  // ── Start ──
  $$('[data-setting]', grid).forEach(queueFor);
  if ('ResizeObserver' in window) {
    grid.classList.add('packed');
    observer = new ResizeObserver(() => repack());
    $$('.wc-card', grid).forEach((card) => observer.observe(card));
    window.addEventListener('load', repack);
    repack();
  }
})();
