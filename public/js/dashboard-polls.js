'use strict';

// The Polls & predictions card (views/cards/polls.ejs). The live panel of what runs on Twitch, drawn with the bar's own
// model (public/overlay/pollModel.js) from the card's data-live, then from GET /dashboard/api/polls/live: every 2 s while
// something runs or just ended, every 10 s otherwise, never while the tab is hidden. Its buttons (End now, Lock now,
// the winner, Cancel and refund) and the templates' ▶ send one request at a time. The template pop-up adds or changes a
// template or starts one once; the chat messages pop-up saves the six texts together; Check again follows Twitch's
// "not an Affiliate". Built on the working cards' page script (window.ATLETA_CARD_UI, dashboard-cards.js): its
// requests, pop-up and messages. Texts: window.ATLETA_CARD_TEXTS.polls. What Twitch sent or the streamer typed is set
// as text. Served as it is (no build step).
(function () {
  const ui = window.ATLETA_CARD_UI;
  const model = window.PollBarModel;
  const card = document.getElementById('card-polls');
  if (!ui || !model || !card) return;
  const T = ui.T || {};
  const P = T.polls || {};
  const { $, $$, core, call } = ui;
  const locale = document.documentElement.lang || 'en';

  // ── Check again (Twitch said the channel is not an Affiliate or Partner) ──

  ui.onClick('[data-polls-recheck]', async (button) => {
    button.disabled = true;
    const answer = await call('POST', '/dashboard/api/polls/affiliate-check', {});
    if (answer.ok) {
      window.location.reload();
      return;
    }
    button.disabled = false;
    ui.showMessage(card, answer);
  });

  const panelBox = $('[data-polls-live]', card);
  const list = $('[data-list="templates"]', card);
  if (!panelBox || !list) return; // a setup step: nothing else on the card
  const limits = JSON.parse(card.dataset.limits || '{}');

  // ── What runs ──

  let live = JSON.parse(card.dataset.live || '{}');
  let offset = typeof live.serverNow === 'number' ? live.serverNow - Date.now() : 0; // the server's clock minus this one
  const now = () => Date.now() + offset;
  const running = (view) => !!view && view.state !== 'ended';
  let busy = false; // a panel button's request is on its way
  let starting = false; // a start is on its way
  let timer = null;

  // The texts pollModel.render() fills for the card (the bar has its own).
  const panelTexts = {
    poll: P.kindPoll, prediction: P.kindPrediction, locked: P.locked, result: '', votes: P.votes, pointsViewers: P.pointsShort,
    pollFoot: P.votes, predictionFoot: P.totalPoints, winners: P.pointsShort, tie: '', noVotes: '', cancelled: '',
  };
  const panels = { poll: null, prediction: null }; // drawn: { key, root, corner, rows: [{ row, fill, pc, ct }], total }
  const resultLine = document.createElement('div');
  resultLine.className = 'wc-winner';
  resultLine.setAttribute('role', 'status');
  panelBox.append(resultLine);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(className, text, data) {
    const button = el('button', `btn ${className} wc-btn xs`, text);
    button.type = 'button';
    Object.assign(button.dataset, data);
    return button;
  }

  // A running or locked poll or prediction: its kind, title and time left (or Locked), each choice with its bar, and
  // its buttons.
  function buildPanel(view) {
    const isPoll = view.kind === 'poll';
    const root = el('div', isPoll ? 'wc-live-poll' : 'wc-live-poll pred');
    const top = el('div', 'lp-top');
    const corner = el('span', view.state === 'locked' ? 'lp-lock' : 'lp-left');
    top.append(el('span', isPoll ? 'lp-kind' : 'lp-kind pred', isPoll ? P.kindPoll : P.kindPrediction), el('b', '', view.title), corner);
    root.append(top);
    const rows = view.options.map((option) => {
      const row = el('div', 'lp-opt');
      const bar = el('span', 'bar');
      const fill = el('i');
      bar.append(fill);
      const pc = el('span', 'pc');
      const ct = el('span', 'ct');
      row.append(el('span', 'nm', option.title), bar, pc, ct);
      root.append(row);
      return { row, fill, pc, ct };
    });
    if (view.state === 'locked') {
      const pick = el('div', 'lp-pick');
      pick.append(el('span', '', P.whoWon));
      for (const option of view.options) {
        pick.append(action('btn-primary', core.fill(P.outcomeWon, { outcome: option.title }), { predictionWinner: option.id, predictionId: view.id }));
      }
      root.append(pick);
    }
    const foot = el('div', 'lp-foot');
    const total = el('span');
    foot.append(total);
    if (isPoll) {
      foot.append(action('btn-secondary', P.endNow, { pollEnd: view.id }));
    } else {
      if (view.state === 'running') foot.append(action('btn-secondary', P.lockNow, { predictionLock: view.id }));
      foot.append(action('btn-secondary wc-danger', P.cancelRefund, { predictionCancel: view.id }));
    }
    root.append(foot);
    return { root, corner, rows, total };
  }

  // Draws what runs: a panel per running or locked poll and prediction (built anew only when it changes, so its bars
  // glide and a focused button stays), and the line of what ended in the last 30 seconds.
  function draw() {
    const t = now();
    let moved = false;
    for (const kind of ['poll', 'prediction']) {
      const view = running(live[kind]) ? live[kind] : null;
      let panel = panels[kind];
      if (!view) {
        if (panel) {
          panel.root.remove();
          panels[kind] = null;
          moved = true;
        }
        continue;
      }
      const key = `${view.id}:${view.state}:${view.options.length}`;
      if (!panel || panel.key !== key) {
        if (panel) panel.root.remove();
        panel = { key, ...buildPanel(view) };
        panels[kind] = panel;
        panelBox.insertBefore(panel.root, kind === 'poll' ? panelBox.firstChild : resultLine);
        moved = true;
      }
      const drawn = model.render(view, t, panelTexts, locale);
      panel.corner.textContent = drawn.corner.text;
      drawn.rows.forEach((r, i) => {
        const row = panel.rows[i];
        row.row.className = 'lp-opt' + (r.color ? ' ' + r.color : '') + (r.lead ? ' lead' : '');
        row.fill.style.width = r.percent + '%';
        row.pc.textContent = r.percent + '%';
        row.ct.textContent = r.extra;
      });
      panel.total.textContent = drawn.footer;
      if (busy) $$('button', panel.root).forEach((button) => { button.disabled = true; });
    }
    const ended = [live.prediction, live.poll].find((view) => view && view.state === 'ended');
    const line = ended ? core.pollResultLine(ended, P, locale) : '';
    if (resultLine.textContent !== line) {
      resultLine.textContent = line;
      moved = true;
    }
    resultLine.classList.toggle('show', !!line);
    if (moved) ui.repack();
  }

  // The ▶ of a kind that runs (or waits for its winner) is off, saying why; every ▶ is off while a start is on its way.
  function syncStarts() {
    const blocked = { poll: running(live.poll), prediction: running(live.prediction) };
    for (const start of $$('[data-start]', list)) {
      const kind = start.dataset.start;
      start.disabled = starting || !!blocked[kind];
      start.title = blocked[kind] ? (kind === 'prediction' ? P.predictionRunningHint : P.pollRunningHint) : P.start;
    }
  }

  function showStatus(status) {
    const line = $('[data-status]', card);
    if (!line || !status) return;
    line.textContent = status.text;
    line.className = 'wc-status' + (status.tone === 'ok' ? '' : ' ' + status.tone);
  }

  // What the server answered about what runs: { poll, prediction, serverNow, status }.
  function take(data) {
    live = { poll: data.poll || null, prediction: data.prediction || null, serverNow: data.serverNow };
    if (typeof data.serverNow === 'number') offset = data.serverNow - Date.now();
    showStatus(data.status);
    syncStarts();
    draw();
  }

  function schedule() {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(refresh, core.pollsRefreshMs(live));
  }
  async function refresh() {
    clearTimeout(timer);
    const answer = await call('GET', '/dashboard/api/polls/live');
    if (answer.ok) {
      take(answer.data);
    } else if (answer.kind === 'session' || answer.code === 'needs_reconnect') {
      ui.showMessage(card, answer); // the page has to be loaded again: stop asking
      return;
    }
    schedule();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  setInterval(() => {
    if (running(live.poll) || running(live.prediction)) draw(); // the time left
  }, 1000);

  // ── The live panel's buttons: one request at a time ──

  async function act(url, body) {
    if (busy) return;
    busy = true;
    $$('button', panelBox).forEach((button) => { button.disabled = true; });
    let answer;
    try {
      answer = await call('POST', url, body);
    } finally {
      busy = false;
      $$('button', panelBox).forEach((button) => { button.disabled = false; });
    }
    if (!answer.ok) {
      ui.showMessage(card, answer);
      refresh(); // Twitch may have moved on meanwhile: show where it stands
      return;
    }
    ui.clearMessage(card);
    take(answer.data.live);
    schedule();
  }
  ui.onClick('[data-poll-end]', (button) => act('/dashboard/api/polls/end', { id: button.dataset.pollEnd }));
  ui.onClick('[data-prediction-lock]', (button) => act('/dashboard/api/predictions/lock', { id: button.dataset.predictionLock }));
  ui.onClick('[data-prediction-winner]', (button) => act('/dashboard/api/predictions/resolve', { id: button.dataset.predictionId, outcomeId: button.dataset.predictionWinner }));
  ui.onClick('[data-prediction-cancel]', (button) => {
    if (window.confirm(P.confirmCancel)) act('/dashboard/api/predictions/cancel', { id: button.dataset.predictionCancel });
  });

  // ── Starting: a template's ▶, or the pop-up's Start without saving ──

  // Resolves to the answer, or null while another start is on its way.
  async function start(body) {
    if (starting) return null;
    starting = true;
    syncStarts();
    let answer;
    try {
      answer = await call('POST', '/dashboard/api/polls/start', body);
    } finally {
      starting = false;
    }
    if (answer.ok) {
      ui.clearMessage(card);
      take(answer.data.live);
      ui.announce(P.started);
      schedule();
    } else {
      syncStarts();
    }
    return answer;
  }
  ui.onClick('[data-start]', async (button) => {
    const answer = await start({ templateId: Number(button.closest('[data-row]').dataset.id) });
    if (answer && !answer.ok) ui.showMessage(card, answer);
  });

  // ── Templates ──

  function fillTemplateRow(row, template) {
    row.dataset.id = template.id;
    row.dataset.template = JSON.stringify({
      kind: template.kind, title: template.title, choices: template.choices, durationSeconds: template.durationSeconds, pointsPerVote: template.pointsPerVote,
    });
    const tag = $('[data-field="kind"]', row);
    tag.className = template.kind === 'prediction' ? 'lp-kind pred' : 'lp-kind';
    tag.textContent = template.kind === 'prediction' ? P.kindPredictionShort : P.kindPoll;
    $('[data-field="title"]', row).textContent = template.title;
    $('[data-field="summary"]', row).textContent = core.templateSummary(template, P);
    const startButton = $('[data-start]', row);
    startButton.dataset.start = template.kind;
    startButton.setAttribute('aria-label', P.start + ': ' + template.title);
    $('[data-edit="poll-template"]', row).setAttribute('aria-label', P.edit + ': ' + template.title);
    $('[data-delete="poll-template"]', row).setAttribute('aria-label', P.delete + ': ' + template.title);
  }

  // After a template is added, changed or deleted: the count, the empty hint and the ▶ states; the status line counts
  // the templates too.
  function afterTemplatesChange() {
    const rows = $$('[data-row]', list);
    const count = $('[data-count="templates"]', card);
    if (count) count.textContent = String(rows.length);
    const empty = $('[data-empty="templates"]', card);
    if (empty) empty.hidden = rows.length > 0;
    syncStarts();
    ui.clearMessage(card);
    ui.showSaved(card);
    ui.refreshSoon();
    ui.repack();
  }

  // The template pop-up's fields, within the kind's limits: the question with the characters left, the choices (Add a
  // choice and the remove buttons follow Twitch's counts), the time (the kind's choices; a saved one outside them stays
  // one) and, for a poll, the channel-points votes. Start without saving runs it once. Returns what the fields say.
  function setupTemplateForm(editor, saved) {
    let kind = saved ? saved.kind : 'poll';
    const title = $('[data-field="title"]', editor);
    const titleLeft = $('[data-left-for="title"]', editor);
    const choices = $('[data-choices]', editor);
    const addChoice = $('[data-add-choice]', editor);
    const duration = $('[data-field="durationSeconds"]', editor);
    const pointsOn = $('[data-field="pointsOn"]', editor);
    const points = $('[data-field="pointsPerVote"]', editor);
    const limit = () => limits[kind] || {};
    const left = (input, counter, max) => {
      counter.textContent = core.fill(P.left, { count: max - Array.from(input.value).length });
    };
    const choiceInputs = () => $$('[data-choice]', choices);

    function syncChoices() {
      const inputs = choiceInputs();
      addChoice.hidden = inputs.length >= limit().maxChoices;
      $$('[data-remove-choice]', choices).forEach((button) => { button.hidden = inputs.length <= limit().minChoices; });
      inputs.forEach((input) => left(input, $('[data-left]', input.parentNode), limit().choiceMax));
    }
    function addChoiceRow(text) {
      const row = document.getElementById('tpl-poll-choice').content.firstElementChild.cloneNode(true);
      const input = $('[data-choice]', row);
      input.value = text || '';
      input.addEventListener('input', () => left(input, $('[data-left]', row), limit().choiceMax));
      $('[data-remove-choice]', row).addEventListener('click', () => {
        row.remove();
        syncChoices();
      });
      choices.append(row);
      return input;
    }
    function fillDurations(value) {
      const range = limit();
      const options = [...new Set([...((limits.durations || {})[kind] || []), value])]
        .filter((s) => Number.isInteger(s) && s >= range.minSeconds && s <= range.maxSeconds)
        .sort((a, b) => a - b);
      duration.replaceChildren(...options.map((s) => {
        const option = document.createElement('option');
        option.value = String(s);
        option.textContent = core.pollTime(s, P);
        return option;
      }));
      duration.value = String(options.includes(value) ? value : options[0]);
    }
    function setKind(next) {
      const keep = Number(duration.value) || (saved ? saved.durationSeconds : 120);
      kind = next;
      $$('[data-kind]', editor).forEach((button) => button.setAttribute('aria-checked', String(button.dataset.kind === kind)));
      $$('[data-label-for]', editor).forEach((label) => { label.hidden = label.dataset.labelFor !== kind; });
      $$('[data-poll-only]', editor).forEach((field) => {
        field.hidden = kind !== 'poll' || (field.hasAttribute('data-points-field') && !pointsOn.checked);
      });
      fillDurations(keep);
      left(title, titleLeft, limit().titleMax);
      syncChoices();
    }
    function value() {
      return {
        kind,
        title: title.value,
        choices: choiceInputs().map((input) => input.value),
        durationSeconds: Number(duration.value),
        pointsPerVote: kind === 'poll' && pointsOn.checked ? Number(points.value) : null,
      };
    }

    title.value = saved ? saved.title : '';
    title.addEventListener('input', () => left(title, titleLeft, limit().titleMax));
    for (const text of saved ? saved.choices : ['', '']) addChoiceRow(text);
    addChoice.addEventListener('click', () => {
      addChoiceRow('').focus();
      syncChoices();
    });
    pointsOn.checked = !!(saved && saved.pointsPerVote);
    points.value = saved && saved.pointsPerVote ? String(saved.pointsPerVote) : '100';
    pointsOn.addEventListener('change', () => setKind(kind));
    $$('[data-kind]', editor).forEach((button) => button.addEventListener('click', () => setKind(button.dataset.kind)));
    setKind(kind);

    const once = $('[data-start-once]', editor);
    once.addEventListener('click', async () => {
      once.disabled = true;
      const answer = await start(value());
      once.disabled = false;
      if (!answer) return;
      if (answer.ok) ui.closeEditor(editor);
      else ui.dialogMessage(editor, answer);
    });
    return { value };
  }

  function templateEditor(from, row) {
    const saved = row ? JSON.parse(row.dataset.template) : null;
    let form = null;
    ui.openEditor('tpl-poll-template', from.dataset.title, from, (editor) => {
      form = setupTemplateForm(editor, saved);
    }, async (editor) => {
      const body = form.value();
      const answer = row
        ? await call('PATCH', '/dashboard/api/poll-templates/' + row.dataset.id, body)
        : await call('POST', '/dashboard/api/poll-templates', body);
      if (!answer.ok) {
        ui.dialogMessage(editor, answer);
        return false;
      }
      let target = row;
      if (!target) {
        target = document.getElementById('tpl-poll-template-row').content.firstElementChild.cloneNode(true);
        list.append(target);
      }
      fillTemplateRow(target, answer.data.template);
      afterTemplatesChange();
      return true;
    });
  }
  ui.onClick('[data-add="poll-template"]', (button) => templateEditor(button, null));
  ui.onClick('[data-edit="poll-template"]', (button) => templateEditor(button, button.closest('[data-row]')));
  ui.onClick('[data-delete="poll-template"]', async (button) => {
    const row = button.closest('[data-row]');
    const saved = JSON.parse(row.dataset.template);
    if (!window.confirm(core.fill(P.confirmDelete, { title: saved.title }))) return;
    const answer = await call('DELETE', '/dashboard/api/poll-templates/' + row.dataset.id);
    if (!answer.ok) {
      ui.showMessage(card, answer);
      return;
    }
    const next = ui.nextVisibleRow(row);
    row.remove();
    afterTemplatesChange();
    ui.focusAfterDelete(card, 'poll-template', next);
  });

  // ── The chat messages: the six texts, saved together ──

  const texts = {}; // the texts as saved, by column
  const textsTemplate = document.getElementById('tpl-poll-texts');
  if (textsTemplate) for (const area of textsTemplate.content.querySelectorAll('[data-text-key]')) texts[area.dataset.textKey] = area.value;
  ui.onClick('[data-edit="poll-texts"]', (button) => {
    ui.openEditor('tpl-poll-texts', button.dataset.title, button, (editor) => {
      const chips = $('[data-vars]', editor);
      const showVars = (area) => {
        chips.replaceChildren(...area.dataset.textVars.split(' ').filter(Boolean).map((name) => {
          const chip = el('button', 'wc-var', name);
          chip.type = 'button';
          chip.addEventListener('click', () => ui.insertAtCursor(area, name));
          return chip;
        }));
      };
      const areas = $$('[data-text-key]', editor);
      for (const area of areas) {
        area.value = texts[area.dataset.textKey] || '';
        area.addEventListener('focus', () => showVars(area));
      }
      if (areas[0]) showVars(areas[0]);
    }, async (editor) => {
      const changes = $$('[data-text-key]', editor).map((area) => ({ key: area.dataset.textKey, value: area.value }));
      const answer = await call('POST', '/dashboard/settings', { changes });
      if (!answer.ok) {
        ui.dialogMessage(editor, answer);
        return false;
      }
      Object.assign(texts, answer.data.values);
      ui.clearMessage(card);
      ui.showSaved(card);
      return true;
    });
  });

  // "Announcements need the chatbot" while the announcements are on and the chatbot is off.
  function syncChatNote() {
    const note = $('[data-polls-chat-note]', card);
    const announce = $('[data-setting="polls_chat_enabled"]', card);
    const chatbot = document.querySelector('[data-setting="chatbot_enabled"]');
    if (!note || !announce) return;
    note.hidden = !(announce.checked && chatbot && !chatbot.checked);
    ui.repack();
  }
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-setting="polls_chat_enabled"], [data-setting="chatbot_enabled"]')) syncChatNote();
  });

  // ── Start ──
  syncStarts();
  draw();
  refresh();
})();
