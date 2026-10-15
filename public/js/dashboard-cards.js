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

  // ── The pop-up editor ──

  const dialog = document.getElementById('wc-dialog');
  let opener = null;
  // Whether the pop-up still holds this editor: an answer that comes late must not act on the one that replaced it.
  const holds = (editor) => !!dialog && dialog.open && dialog.firstElementChild === editor;
  // Opens the pop-up with one of the page's <template>s: `setup(editor)` fills it; Save (or Enter in a one-line field)
  // runs `save(editor)` and closes the pop-up when that resolves true. Esc, Cancel and a click on the dimmed page close
  // it; the focus goes back to the button that opened it. A refusal keeps the pop-up open, with the focus on Save.
  function openEditor(templateId, title, from, setup, save) {
    const template = document.getElementById(templateId);
    if (!dialog || !template) return null;
    opener = from;
    dialog.replaceChildren(template.content.cloneNode(true));
    const editor = dialog.firstElementChild;
    const heading = $('[data-title]', editor);
    if (heading) heading.textContent = title || '';
    if (setup) setup(editor);
    $$('[data-cancel]', editor).forEach((button) => button.addEventListener('click', () => closeEditor(editor)));
    const saveButton = $('[data-save]', editor);
    if (saveButton) {
      saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        let done = false;
        try {
          done = await save(editor);
        } finally {
          saveButton.disabled = false;
        }
        if (done) {
          closeEditor(editor);
        } else if (holds(editor)) {
          // Disabling Save took the focus off it: put it back, so a keyboard user is not left on the page with the
          // refusal (a field the streamer moved to meanwhile keeps it).
          const active = document.activeElement;
          if (active === saveButton || !editor.contains(active)) saveButton.focus();
        }
      });
      // Enter in a one-line field saves, as the button does: not in a text area (a new line), not while an input
      // method is composing text (Enter confirms it), and a button keeps its own action.
      editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || !event.target.matches('input')) return;
        event.preventDefault();
        saveButton.click();
      });
    }
    dialog.showModal();
    const first = $('textarea, input, select', editor);
    if (first) {
      first.focus();
      if (first.tagName === 'TEXTAREA' || first.type === 'text') first.setSelectionRange(first.value.length, first.value.length);
    }
    return editor;
  }
  // Closes the pop-up, or only `editor`'s: the answer to a save the streamer closed meanwhile must not close the pop-up
  // that opened after it.
  function closeEditor(editor) {
    if (dialog && dialog.open && (!editor || dialog.firstElementChild === editor)) dialog.close();
  }
  if (dialog) {
    let pressedOnPage = false;
    const outsideBox = (event) => {
      const box = dialog.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    };
    dialog.addEventListener('close', () => {
      dialog.replaceChildren();
      pressedOnPage = false;
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    });
    // A click on the dimmed page around the pop-up closes it, as Esc does: when the press began there too. A text
    // selection dragged out of a field and released over the dimmed page also ends in a click on the dialog, but it
    // is not a click on the page (the typed text would be lost).
    dialog.addEventListener('mousedown', (event) => {
      pressedOnPage = event.target === dialog && outsideBox(event);
    });
    dialog.addEventListener('click', (event) => {
      const began = pressedOnPage;
      pressedOnPage = false;
      if (event.target === dialog && began && outsideBox(event)) closeEditor();
    });
  }
  const dialogMessage = (editor, answer) => showMessage(null, answer, { box: $('[data-dialog-msg]', editor) });
  const clearDialogMessage = (editor) => {
    const box = $('[data-dialog-msg]', editor);
    if (box && !box.hidden) {
      box.hidden = true;
      box.textContent = '';
    }
  };
  function insertAtCursor(area, text) {
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    area.value = area.value.slice(0, start) + text + area.value.slice(end);
    area.focus();
    area.selectionStart = area.selectionEnd = start + text.length;
  }
  // A button that says what happened for a moment, then its own words again.
  function flash(button, text) {
    const before = button.textContent;
    button.textContent = text;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = before;
      button.disabled = false;
    }, 1800);
  }
  // A ▶ button that worked turns green for a moment.
  function tick(button) {
    button.classList.add('done');
    setTimeout(() => button.classList.remove('done'), 1500);
  }
  // A new row made from a row <template>, first in its list.
  function addRow(templateId, list) {
    const row = document.getElementById(templateId).content.firstElementChild.cloneNode(true);
    list.insertBefore(row, list.firstChild);
    return row;
  }
  // After a row is added or deleted: the count, the empty hint and Show all (offered only while a row is hidden).
  function afterListChange(card, name) {
    const list = $('[data-list="' + name + '"]', card);
    const rows = $$('[data-row]', list);
    const empty = $('[data-empty="' + name + '"]', card);
    if (empty) empty.hidden = rows.length > 0;
    const more = $('[data-show-all="' + list.id + '"]', card);
    if (more) {
      more.hidden = !rows.some((row) => row.classList.contains('hidden'));
      if (!list.classList.contains('show-all')) more.textContent = core.fill(T.showAll, { count: rows.length });
    }
    const count = $('[data-count="' + name + '"]', card);
    if (count) count.textContent = String(rows.length);
    repack();
  }
  // The row after this one that is on the page (not behind Show all), for the focus once this one is deleted.
  function nextVisibleRow(row) {
    for (let next = row.nextElementSibling; next; next = next.nextElementSibling) {
      if (next.hasAttribute('data-row') && getComputedStyle(next).display !== 'none') return next;
    }
    return null;
  }
  // After a delete the button that had the focus is gone: the focus goes to the next row's edit button, else to the
  // list's Add button.
  function focusAfterDelete(card, kind, next) {
    const target = (next && $('[data-edit="' + kind + '"]', next)) || $('[data-add="' + kind + '"]', card);
    if (target) target.focus();
  }

  // ── Thank-you messages ──

  onClick('[data-edit="thankyou"]', (button) => {
    const card = button.closest('.wc-card');
    const row = button.closest('.wc-row');
    openEditor('tpl-thankyou', button.dataset.title, button, (editor) => {
      const area = $('[data-field="text"]', editor);
      area.value = button.dataset.value || '';
      const vars = $('[data-vars]', editor);
      for (const name of (button.dataset.vars || '').split(' ').filter(Boolean)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wc-var';
        chip.textContent = name;
        chip.addEventListener('click', () => insertAtCursor(area, name));
        vars.appendChild(chip);
      }
      // Posts the saved message in the streamer's chat with example values (the chatbot page's test). The route posts
      // the saved text, so while the box holds another one (spaces around it aside: a save trims them) the pop-up asks
      // to save first instead.
      const test = $('[data-chat-test]', editor);
      test.addEventListener('click', async () => {
        if (area.value.trim() !== (button.dataset.value || '').trim()) {
          dialogMessage(editor, T.saveFirst);
          return;
        }
        const answer = await call('POST', '/dashboard/chatbot/test/' + encodeURIComponent(button.dataset.event));
        if (answer.ok) {
          clearDialogMessage(editor);
          flash(test, T.sentToChat);
        } else {
          dialogMessage(editor, answer);
        }
      });
    }, async (editor) => {
      const answer = await call('POST', '/dashboard/settings', { key: button.dataset.key, value: $('[data-field="text"]', editor).value });
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      button.dataset.value = answer.data.value;
      $('[data-text]', row).textContent = answer.data.value;
      clearMessage(card);
      showSaved(card);
      return true;
    });
  });

  // ── Commands ──

  // A select set to a value, which becomes a choice when it is not one yet (a cooldown saved on the chatbot page).
  function selectValue(select, value) {
    const text = String(value);
    if (!$$('option', select).some((option) => option.value === text)) {
      const option = document.createElement('option');
      option.value = text;
      option.textContent = core.fill(T.seconds, { seconds: text });
      select.appendChild(option);
    }
    select.value = text;
  }
  function fillCommandRow(row, command) {
    row.dataset.id = command.id;
    row.dataset.name = command.command;
    row.dataset.response = command.response;
    row.dataset.cooldown = command.cooldown;
    $('[data-field="name"]', row).textContent = command.command;
    $('[data-field="response"]', row).textContent = command.response;
    $('[data-edit="command"]', row).dataset.title = core.fill(T.commandEditTitle, { name: command.command });
  }
  function commandEditor(from, row) {
    const card = from.closest('.wc-card');
    openEditor('tpl-command', from.dataset.title, from, (editor) => {
      $('[data-field="command"]', editor).value = row ? row.dataset.name : '';
      $('[data-field="response"]', editor).value = row ? row.dataset.response : '';
      selectValue($('[data-field="cooldown"]', editor), row ? row.dataset.cooldown : 10);
    }, async (editor) => {
      const body = {
        command: $('[data-field="command"]', editor).value.trim().replace(/^!+/, ''),
        response: $('[data-field="response"]', editor).value,
        cooldown: Number($('[data-field="cooldown"]', editor).value),
      };
      const answer = row ? await call('PATCH', '/dashboard/api/commands/' + row.dataset.id, body) : await call('POST', '/dashboard/api/commands', body);
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      fillCommandRow(row || addRow('tpl-command-row', $('[data-list="commands"]', card)), answer.data.command);
      afterListChange(card, 'commands');
      clearMessage(card);
      showSaved(card);
      refreshSoon();
      return true;
    });
  }
  onClick('[data-add="command"]', (button) => commandEditor(button, null));
  onClick('[data-edit="command"]', (button) => commandEditor(button, button.closest('[data-row]')));
  onClick('[data-delete="command"]', async (button) => {
    const row = button.closest('[data-row]');
    const card = button.closest('.wc-card');
    if (!window.confirm(core.fill(T.confirmDeleteCommand, { name: row.dataset.name }))) return;
    const answer = await call('DELETE', '/dashboard/api/commands/' + row.dataset.id);
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    const next = nextVisibleRow(row);
    row.remove();
    afterListChange(card, 'commands');
    clearMessage(card);
    showSaved(card);
    refreshSoon();
    focusAfterDelete(card, 'command', next);
  });
  // The built-in commands: the thirteen as toggles in the pop-up, saved together (one batch, all or nothing).
  onClick('[data-edit="builtins"]', (button) => {
    const card = button.closest('.wc-card');
    const pills = $$('[data-builtin]', card);
    openEditor('tpl-builtins', button.dataset.title, button, (editor) => {
      const chips = $('[data-chips]', editor);
      for (const pill of pills) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wc-chip' + (pill.hidden ? '' : ' on');
        chip.dataset.key = pill.dataset.builtin;
        chip.setAttribute('aria-pressed', String(!pill.hidden));
        const mark = document.createElement('span');
        mark.className = 'tick';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '✓';
        chip.append(mark, document.createTextNode(pill.dataset.name));
        chip.addEventListener('click', () => {
          const on = chip.getAttribute('aria-pressed') !== 'true';
          chip.setAttribute('aria-pressed', String(on));
          chip.classList.toggle('on', on);
        });
        chips.appendChild(chip);
      }
    }, async (editor) => {
      const changes = $$('[data-key]', editor).map((chip) => ({ key: chip.dataset.key, value: chip.getAttribute('aria-pressed') === 'true' }));
      const answer = await call('POST', '/dashboard/settings', { changes });
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      for (const pill of pills) pill.hidden = !answer.data.values[pill.dataset.builtin];
      $('[data-builtins-none]', card).hidden = pills.some((pill) => !pill.hidden);
      clearMessage(card);
      showSaved(card);
      refreshSoon();
      repack();
      return true;
    });
  });

  // ── Sponsor messages ──

  function fillSponsorRow(row, message) {
    row.dataset.id = message.id;
    row.dataset.text = message.message_text;
    row.dataset.url = message.url || '';
    $('[data-field="text"]', row).textContent = message.message_text;
    const toggle = $('[data-setting="sponsor_message_enabled"]', row);
    toggle.dataset.id = message.id;
    toggle.setAttribute('aria-label', message.message_text);
  }
  function sponsorEditor(from, row) {
    const card = from.closest('.wc-card');
    openEditor('tpl-sponsor', from.dataset.title, from, (editor) => {
      $('[data-field="message_text"]', editor).value = row ? row.dataset.text : '';
      $('[data-field="url"]', editor).value = row ? row.dataset.url : '';
    }, async (editor) => {
      const body = { message_text: $('[data-field="message_text"]', editor).value, url: $('[data-field="url"]', editor).value };
      const answer = row
        ? await call('POST', '/dashboard/sponsor-messages/' + row.dataset.id + '/update', body)
        : await call('POST', '/dashboard/sponsor-messages/add', body);
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      if (row) {
        fillSponsorRow(row, { id: row.dataset.id, message_text: body.message_text.trim(), url: body.url.trim() });
      } else {
        const added = addRow('tpl-sponsor-row', $('[data-list="sponsors"]', card));
        fillSponsorRow(added, answer.data.message);
        const toggle = $('[data-setting="sponsor_message_enabled"]', added);
        toggle.checked = !!answer.data.message.enabled;
        queueFor(toggle);
      }
      afterListChange(card, 'sponsors');
      clearMessage(card);
      showSaved(card);
      refreshSoon();
      return true;
    });
  }
  onClick('[data-add="sponsor"]', (button) => sponsorEditor(button, null));
  onClick('[data-edit="sponsor"]', (button) => sponsorEditor(button, button.closest('[data-row]')));
  onClick('[data-delete="sponsor"]', async (button) => {
    const row = button.closest('[data-row]');
    const card = button.closest('.wc-card');
    if (!window.confirm(T.confirmDeleteSponsor)) return;
    const answer = await call('POST', '/dashboard/sponsor-messages/' + row.dataset.id + '/delete', {});
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    const next = nextVisibleRow(row);
    row.remove();
    afterListChange(card, 'sponsors');
    clearMessage(card);
    showSaved(card);
    refreshSoon();
    focusAfterDelete(card, 'sponsor', next);
  });

  // ── The tip goal ──

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: currency || 'EUR' }).format(Number(amount) || 0);
    } catch (e) {
      return (Number(amount) || 0).toFixed(2) + ' ' + (currency || '');
    }
  }
  function showGoal(card, goal) {
    const box = $('[data-goal]', card);
    box.hidden = !goal;
    $('[data-goal-none]', card).hidden = !!goal;
    $('[data-goal-button]', card).textContent = goal ? T.edit : T.startGoal;
    if (goal) {
      const current = Number(goal.current_amount) || 0;
      const target = Number(goal.target_amount) || 0;
      Object.assign(box.dataset, { title: goal.title, current: String(current), target: String(target), currency: goal.currency });
      $('[data-goal-title]', box).textContent = goal.title;
      $('[data-goal-amount]', box).textContent = core.fill(T.goalAmount, { raised: money(current, goal.currency), target: money(target, goal.currency) });
      $('[data-goal-bar]', box).style.width = (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0) + '%';
    }
    repack();
  }
  onClick('[data-edit="goal"]', (button) => {
    const card = button.closest('.wc-card');
    const box = $('[data-goal]', card);
    const running = !box.hidden;
    openEditor('tpl-goal', button.dataset.title, button, (editor) => {
      $('[data-field="title"]', editor).value = running ? box.dataset.title : '';
      $('[data-field="target_amount"]', editor).value = running ? box.dataset.target : '';
      $('[data-goal-hint]', editor).textContent = core.fill(T.goalHint, { raised: money(running ? box.dataset.current : 0, box.dataset.currency), currency: box.dataset.currency });
      const end = $('[data-goal-end]', editor);
      if (!running) {
        end.hidden = true;
        return;
      }
      end.addEventListener('click', async () => {
        if (!window.confirm(T.confirmEndGoal)) return;
        const answer = await call('POST', '/dashboard/api/tip-goal/end', {});
        if (!answer.ok) {
          dialogMessage(editor, answer);
          return;
        }
        showGoal(card, null);
        closeEditor(editor);
        clearMessage(card);
        showSaved(card);
      });
    }, async (editor) => {
      const body = { title: $('[data-field="title"]', editor).value, target_amount: $('[data-field="target_amount"]', editor).value };
      const answer = running ? await call('PATCH', '/dashboard/api/tip-goal', body) : await call('POST', '/dashboard/api/tip-goal', body);
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      showGoal(card, answer.data.goal);
      clearMessage(card);
      showSaved(card);
      return true;
    });
  });

  // ── Test buttons ──

  onClick('[data-alert-test]', async (button) => {
    const card = button.closest('.wc-card');
    const answer = await call('POST', '/dashboard/overlay/test/' + encodeURIComponent(button.dataset.alertTest));
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    clearMessage(card);
    tick(button);
    announce(T.alertSent);
  });
  onClick('[data-reward-test]', async (button) => {
    const card = button.closest('.wc-card');
    const answer = await call('POST', '/dashboard/redemptions/' + encodeURIComponent(button.dataset.rewardTest) + '/test');
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    clearMessage(card);
    tick(button);
    announce(T.rewardPlayed);
  });

  // ── Channel point rewards: each reward's switch (the rewards page's own route) ──

  const rewardQueues = new WeakMap();
  function rewardQueue(toggle) {
    if (!rewardQueues.has(toggle)) {
      rewardQueues.set(toggle, core.createLatestQueue((on) => call('PATCH', '/dashboard/redemptions/' + toggle.dataset.rewardId, { enabled: on }), {
        confirmed: toggle.checked,
        onDone(answer, held) {
          const card = toggle.closest('.wc-card');
          if (answer && answer.ok) {
            clearMessage(card);
            showSaved(card);
            refreshSoon();
            return;
          }
          // Twitch may refuse an edit the site has saved: the answer then carries the reward as it is stored.
          const stored = answer && answer.data && answer.data.reward;
          toggle.checked = stored ? !!stored.enabled : !!held;
          reflect(toggle);
          showMessage(card, answer || { ok: false, kind: 'failed' });
        },
      }));
    }
    return rewardQueues.get(toggle);
  }
  grid.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-reward-id]');
    if (!toggle || !grid.contains(toggle)) return;
    reflect(toggle);
    rewardQueue(toggle).push(toggle.checked);
  });
  $$('[data-reward-id]', grid).forEach(rewardQueue);

  // ── Whether the bot is a moderator: Check again ──

  onClick('[data-check-moderator]', async (button) => {
    const card = button.closest('.wc-card');
    button.disabled = true;
    const answer = await call('POST', '/dashboard/chatbot/check-moderator', {});
    button.disabled = false;
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    if (answer.data.moderator === true) {
      $('[data-mod-note]', card).hidden = true;
      clearMessage(card);
      announce(T.moderatorYes);
      repack();
    } else if (answer.data.moderator === null) {
      showMessage(card, T.moderatorUnknown, { info: true });
    } else {
      showMessage(card, T.moderatorNo, { info: true });
    }
  });

  // ── Giveaways ──

  // The giveaway panel. `id` is the giveaway it follows: every answer is dropped when the panel has moved on to another
  // (or none) by the time it arrives. Only the streamer's clicks start a draw; the poll just shows what the server did.
  function setupGiveaway(card) {
    const form = $('[data-giveaway-form]', card);
    const panel = $('[data-giveaway-live]', card);
    if (!form || !panel) return;
    const status = $('[data-status]', card);
    const winnerBox = $('[data-gw-winner]', panel);
    const pick = $('[data-gw-pick]', panel);
    const end = $('[data-gw-end]', panel);
    const startButton = $('button[type="submit"]', form);
    const G = T.giveaway || {};
    let id = panel.dataset.giveawayId || null;
    let endsAt = NaN;
    let entries = 0;
    let pollTimer = null;
    let clockTimer = null;
    let picked = false; // the winners are on display
    let busy = false; // a start, a draw or an end is on its way

    function setStatus(text, tone) {
      status.textContent = text;
      status.className = 'wc-status' + (tone === 'ok' ? '' : ' ' + tone);
    }
    function showClock() {
      $('[data-gw-left]', panel).textContent = Number.isFinite(endsAt) ? core.formatLeft(endsAt - Date.now()) : '–';
    }
    function stopTimers() {
      clearInterval(pollTimer);
      clearInterval(clockTimer);
      pollTimer = null;
      clockTimer = null;
    }
    // Pick needs entries (with none the server would end the giveaway without a winner), and nothing more is sent
    // while a request is on its way.
    function syncButtons() {
      pick.disabled = busy || (!picked && entries < 1);
      end.disabled = busy;
      if (startButton) startButton.disabled = busy;
    }
    function setBusy(on) {
      busy = on;
      syncButtons();
    }
    function setEntries(count) {
      entries = count;
      $('[data-gw-entries]', panel).textContent = String(count);
      syncButtons();
    }
    // The panel of a giveaway that runs: how to enter, the entries (asked every 2 s), the time left (every second).
    function running(giveaway) {
      stopTimers();
      id = String(giveaway.id);
      picked = false;
      endsAt = core.parseUtc(giveaway.ends_at);
      $('[data-gw-keyword]', panel).textContent = '!' + giveaway.keyword;
      $('[data-gw-winners]', panel).textContent = String(giveaway.winners_count || 1);
      winnerBox.classList.remove('show');
      winnerBox.textContent = '';
      pick.textContent = G.pick;
      end.textContent = G.end;
      card.classList.add('gw-running');
      setStatus(G.running, 'warn');
      setEntries(Number(giveaway.entries) || 0);
      showClock();
      pollTimer = setInterval(poll, 2000);
      if (Number.isFinite(endsAt)) clockTimer = setInterval(showClock, 1000);
      repack();
    }
    // The winners are drawn (by a click, or by the server when the time ran out): show them and stop following.
    function drawn(names, message) {
      stopTimers();
      showClock();
      picked = true;
      winnerBox.textContent = names ? core.fill(G.winner, { names }) : (message || G.nobody);
      winnerBox.classList.add('show');
      pick.textContent = G.pickAgain;
      end.textContent = G.done;
      setStatus(names ? G.picked : G.none, names ? 'ok' : 'off');
      syncButtons();
      repack();
    }
    function idle() {
      stopTimers();
      id = null;
      picked = false;
      endsAt = NaN;
      card.classList.remove('gw-running');
      setStatus(G.none, 'off');
      setEntries(0);
      repack();
    }
    async function poll() {
      const mine = id;
      if (!mine) return;
      const answer = await call('GET', '/dashboard/giveaways/' + mine + '/entries');
      if (id !== mine || picked) return;
      if (!answer.ok) {
        if (answer.status === 404) idle(); // the giveaway is gone; any other trouble: the next tick asks again
        return;
      }
      setEntries(Number(answer.data.count) || 0);
      if (answer.data.status === 'open' || busy) return;
      // It is over and this card did not end it: the server did (a timed giveaway closes itself and draws its winners
      // in the same step) or it was closed elsewhere. Show the winners the server drew; with none, it is simply over.
      const winners = (answer.data.entries || []).filter((entry) => entry.is_winner && !entry.is_redrawn_out);
      if (winners.length) drawn(winners.map((winner) => '@' + winner.username).join(', '));
      else idle();
    }
    async function draw(again) {
      const mine = id;
      if (!mine || busy) return;
      setBusy(true);
      try {
        const answer = await call('POST', '/dashboard/giveaways/' + mine + '/pick', again ? { redraw: true } : {});
        if (id !== mine) return;
        if (!answer.ok) {
          if (answer.status === 404) idle();
          showMessage(card, answer);
          return;
        }
        clearMessage(card);
        drawn((answer.data.winners || []).map((winner) => '@' + winner.username).join(', '), answer.data.message);
      } finally {
        setBusy(false);
      }
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(form);
      setBusy(true);
      try {
        const answer = await call('POST', '/dashboard/giveaways/start', {
          keyword: String(data.get('keyword') || '').trim().replace(/^!+/, ''),
          prize: String(data.get('prize') || '').trim(),
          duration_seconds: data.get('duration_seconds') ? Number(data.get('duration_seconds')) : null,
          winners_count: Number(data.get('winners_count')) || 1,
          subs_only: data.get('subs_only') === 'on',
        });
        if (!answer.ok) {
          showMessage(card, answer);
          return;
        }
        clearMessage(card);
        running({ ...answer.data, entries: 0 });
      } finally {
        setBusy(false);
      }
    });
    pick.addEventListener('click', () => draw(picked));
    end.addEventListener('click', async () => {
      if (picked) {
        idle();
        return;
      }
      const mine = id;
      if (!mine || busy) return;
      if (!window.confirm(G.confirmEnd)) return;
      setBusy(true);
      try {
        const answer = await call('POST', '/dashboard/giveaways/' + mine + '/close', {});
        if (id !== mine) return;
        if (!answer.ok && answer.status !== 404) {
          showMessage(card, answer);
          return;
        }
        clearMessage(card);
        idle();
      } finally {
        setBusy(false);
      }
    });
    if (id) {
      running({ id, keyword: panel.dataset.keyword, ends_at: panel.dataset.endsAt, winners_count: Number(panel.dataset.winners), entries: Number(panel.dataset.entries) });
    } else {
      syncButtons();
    }
  }
  const giveawayCard = document.getElementById('card-giveaways');
  if (giveawayCard) setupGiveaway(giveawayCard);

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
