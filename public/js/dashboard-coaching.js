'use strict';

// The Coaching card (views/cards/coaching.ejs). Writes each booking's time, an instant on its row (data-at, UTC
// milliseconds), in this browser's time zone and the page's language (window.COACHING_CORE, public/js/coaching-core.js).
// ✓ and ✕ accept or decline a waiting request (POST /dashboard/api/coaching/bookings/:id/accept|decline; ✕ asks first,
// as the coaching page does): the row goes, an accepted session earlier than the one shown becomes the next session,
// and a viewer Atleta could not message is named on the card. The Bookings open switch saves through its own route
// (POST /dashboard/api/coaching/open), the newest value winning; a refused one flips back with the reason. The status
// line and the badge follow from GET /dashboard/api/cards. Built on the working cards' page script
// (window.ATLETA_CARD_UI, dashboard-cards.js): its requests and messages. Texts: window.ATLETA_CARD_TEXTS.coaching.
// Names come from the page and the answers, and go in as text. Served as it is (no build step).
(function () {
  const ui = window.ATLETA_CARD_UI;
  const C = window.COACHING_CORE;
  const card = document.getElementById('card-coaching');
  if (!ui || !C || !card) return;
  const T = ui.T || {};
  const CT = T.coaching || {};
  const { $, $$, core, call } = ui;
  const lang = document.documentElement.lang || 'en';
  const INFO_MS = 5000;

  function browserZone() {
    let zone = 'UTC';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { zone = 'UTC'; }
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch (e) { zone = 'UTC'; }
    return zone;
  }
  const zone = browserZone();
  const when = (ms) => C.dateLabel(ms, zone, lang) + ', ' + C.timeLabel(ms, zone, lang);
  const lengthText = (minutes) => (Number(minutes) === 30 ? CT.minutes30 : CT.minutes60) || '';

  // A row's time from its instant.
  function writeTime(row) {
    const at = Number(row.dataset.at);
    const out = $('[data-when]', row);
    if (out && row.dataset.at && Number.isFinite(at)) out.textContent = when(at);
  }
  $$('[data-at]', card).forEach(writeTime);

  // A message that says what happened goes after a moment; a refusal or a warning stays until the next action.
  let infoTimer = null;
  function tell(text) {
    clearTimeout(infoTimer);
    ui.showMessage(card, text, { info: true });
    infoTimer = setTimeout(() => ui.clearMessage(card), INFO_MS);
  }
  function warn(answerOrText) {
    clearTimeout(infoTimer);
    ui.showMessage(card, answerOrText);
  }

  // ── The requests ──

  const none = $('[data-coaching-none]', card);
  const next = $('[data-coaching-next]', card);

  // The accepted booking is the next session when it starts before the one shown (or none is shown).
  function offerNext(booking) {
    if (!next || !booking || !Number.isFinite(Number(booking.startsAt))) return;
    const shown = Number(next.dataset.at);
    if (!next.hidden && Number.isFinite(shown) && next.dataset.at && shown <= booking.startsAt) return;
    next.dataset.at = String(booking.startsAt);
    const name = $('[data-name]', next);
    if (name) name.textContent = booking.viewerName || '';
    const length = $('[data-length]', next);
    if (length) length.textContent = lengthText(booking.minutes);
    const problem = $('[data-message-error]', next);
    if (problem) {
      problem.textContent = booking.messageError ? core.fill(CT.messageError, { name: booking.viewerName || '' }) : '';
      problem.hidden = !booking.messageError;
    }
    writeTime(next);
    next.hidden = false;
  }

  ui.onClick('[data-coaching-act]', async (button) => {
    const row = button.closest('[data-booking]');
    if (!row || !card.contains(row)) return;
    const action = button.dataset.coachingAct === 'decline' ? 'decline' : 'accept';
    const name = row.dataset.name || '';
    if (action === 'decline' && !window.confirm(core.fill(CT.declineConfirm, { name }))) return;
    const buttons = $$('button', row);
    buttons.forEach((b) => { b.disabled = true; });
    const answer = await call('POST', '/dashboard/api/coaching/bookings/' + encodeURIComponent(row.dataset.booking) + '/' + action, {});
    if (!answer.ok) {
      buttons.forEach((b) => { b.disabled = false; });
      warn(answer);
      ui.refreshSoon();
      return;
    }
    const booking = (answer.data && answer.data.booking) || {};
    const who = booking.viewerName || name;
    row.remove();
    if (none) none.hidden = !!$('[data-booking]', card);
    if (action === 'accept') offerNext(booking);
    if (booking.messageError) warn(core.fill(CT.messageError, { name: who }));
    else tell(core.fill(action === 'accept' ? CT.accepted : CT.declined, { name: who }));
    ui.refreshSoon();
    ui.repack();
  });

  // ── Bookings open ──

  const openSwitch = $('[data-coaching-open]', card);
  if (openSwitch) {
    const tile = openSwitch.closest('.wc-sw');
    const link = $('[data-coaching-link]', card);
    const reflect = () => {
      if (tile) tile.classList.toggle('is-on', openSwitch.checked);
      if (link) link.classList.toggle('wc-dim', !openSwitch.checked);
    };
    const queue = core.createLatestQueue((value) => call('POST', '/dashboard/api/coaching/open', { open: value }), {
      confirmed: openSwitch.checked,
      onDone(answer, held) {
        if (answer && answer.ok) {
          clearTimeout(infoTimer);
          ui.clearMessage(card);
          ui.showSaved(card);
          ui.refreshSoon();
          return;
        }
        openSwitch.checked = !!held;
        reflect();
        warn(answer || { ok: false, kind: 'failed' });
      },
    });
    openSwitch.addEventListener('change', () => {
      reflect();
      queue.push(openSwitch.checked);
    });
  }
})();
