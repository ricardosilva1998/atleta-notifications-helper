// The Polls & predictions bar: an OBS browser source (/overlay/poll/<token>). It shows the running poll or prediction
// the server sends on the bar's own stream, counts the time down, and shows a result for 10 seconds (pollModel.js
// decides what). Its texts come from the page (window.POLL_BAR_TEXTS, in the language its link names); everything
// Twitch sent is set as text, never as HTML.
(function () {
  'use strict';

  const model = window.PollBarModel;
  const texts = window.POLL_BAR_TEXTS || {};
  const locale = document.documentElement.lang || 'en';
  const root = document.getElementById('poll-root');
  let state = null;
  let offset = 0; // the server's clock minus this machine's
  let serverVersion = null;
  let source = null;
  let retryTimer = null;
  let shown = null; // { key, corner, rows: [{ row, fill, percent, extra }], footer }

  const now = () => Date.now() + offset;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // The panel of one poll or prediction: the chequered strip, the head (label, title, corner), a row per choice (its
  // name and percent, its bar, the line under it) and the footer.
  function build(drawn, key) {
    const panel = node('div', drawn.kind === 'prediction' ? 'pb pred' : 'pb');
    const head = node('div', 'pb-head');
    const corner = node('span', 'pb-corner');
    head.append(node('span', 'pb-kind', drawn.label), node('span', 'pb-title', drawn.title), corner);
    panel.append(node('div', 'pb-flag'), head);
    const rows = drawn.rows.map((r) => {
      const row = node('div', r.color ? `pb-opt ${r.color}` : 'pb-opt');
      const line = node('div', 'pb-line');
      const percent = node('span', 'pb-pc');
      line.append(node('span', 'pb-nm', r.title), percent);
      const bar = node('div', 'pb-bar');
      const fill = node('i');
      bar.append(fill);
      const extra = node('div', 'pb-extra');
      row.append(line, bar, extra);
      panel.append(row);
      return { row, fill, percent, extra };
    });
    const footer = node('div', 'pb-foot');
    panel.append(footer);
    root.textContent = '';
    root.append(panel);
    return { key, corner, rows, footer };
  }

  // Draws what pollModel picks; a new poll or prediction is built (and enters), the same one is updated in place, so
  // its bars glide to their new width.
  function draw() {
    const t = now();
    const view = model.pick(state, t);
    const drawn = model.render(view, t, texts, locale);
    if (!drawn) {
      if (shown) { root.textContent = ''; shown = null; }
      return;
    }
    const key = `${view.kind}:${view.id}:${drawn.rows.length}`;
    if (!shown || shown.key !== key) shown = build(drawn, key);
    shown.corner.textContent = drawn.corner.text;
    shown.corner.className = `pb-corner is-${drawn.corner.type}`;
    drawn.rows.forEach((r, i) => {
      const row = shown.rows[i];
      row.fill.style.width = `${r.percent}%`;
      row.percent.textContent = `${r.percent}%`;
      row.extra.textContent = r.extra;
      row.row.classList.toggle('lead', r.lead);
      row.row.classList.toggle('won', r.won);
      row.row.classList.toggle('lost', r.lost);
    });
    shown.footer.textContent = drawn.footer;
  }

  function connect() {
    if (source) source.close();
    source = new EventSource(`/overlay/poll/events/${window.OVERLAY_TOKEN}`);
    source.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (err) { return; }
      if (data.type === 'config') {
        // A new server version (a deploy): load the page again, for its new script.
        if (serverVersion && data.serverVersion && data.serverVersion !== serverVersion) { location.reload(); return; }
        serverVersion = data.serverVersion;
        return;
      }
      if (data.type === 'poll-state') {
        if (typeof data.serverNow === 'number') offset = data.serverNow - Date.now();
        state = { poll: data.poll || null, prediction: data.prediction || null };
        draw();
      }
    };
    source.onerror = () => {
      source.close();
      source = null;
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 5000);
    };
  }

  setInterval(draw, 250);
  connect();
}());
