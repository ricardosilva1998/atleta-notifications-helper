// The Polls & predictions bar's model (public/overlay/poll.js): from what the server sent ({ poll, prediction }, views
// as services/pollRules.js makes them) and the server's clock, what the bar shows — the prediction when both run (its
// points are at stake), else the poll; a result for 10 seconds; nothing otherwise (the same rule as pollRules'
// pickBarView, which tests/pollBar.test.js compares). Dual-exported: the page reads window.PollBarModel, the tests
// require it.
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PollBarModel = model;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESULT_MS = 10000;

  const recent = (view, now) => !!view && (view.state !== 'ended' || (view.endedAt !== null && now - view.endedAt < RESULT_MS));

  // The view the bar shows at `now` (the server's clock), or null.
  function pick(state, now) {
    if (!state) return null;
    if (recent(state.prediction, now)) return state.prediction;
    if (recent(state.poll, now)) return state.poll;
    return null;
  }

  // 90000 → '1:30': whole seconds rounded up, never below zero.
  function clock(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // What to draw for a view: the label, the title, the corner (the time left, Locked, or Result), each row (its title,
  // percent, the line under its bar, its colour, and whether it leads, won or lost) and the footer, with the bar's
  // texts ({{count}}, {{points}} and {{viewers}} filled in) and the numbers written for `locale`. Exactly one vote
  // takes the singular text (voteOne, pollFootOne) when the texts have it.
  function render(view, now, texts, locale) {
    if (!view) return null;
    const isPoll = view.kind === 'poll';
    const ended = view.state === 'ended';
    const number = (n) => Number(n || 0).toLocaleString(locale || 'en');
    const fill = (text, values) => String(text || '').replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? number(values[key]) : all));
    const votes = (plural, one, count) => fill(Number(count) === 1 && one ? one : plural, { count });
    let corner = { type: 'time', text: view.endsAt !== null ? clock(view.endsAt - now) : '' };
    if (view.state === 'locked') corner = { type: 'locked', text: texts.locked || '' };
    else if (ended) corner = { type: 'result', text: texts.result || '' };
    const most = Math.max(0, ...view.options.map((o) => o.votes));
    const someWon = view.options.some((o) => o.won);
    const rows = view.options.map((o) => {
      let extra = '';
      if (isPoll) extra = votes(texts.votes, texts.voteOne, o.votes);
      else if (ended && o.won) extra = fill(texts.winners, { viewers: o.users, points: view.total });
      else if (!ended) extra = fill(texts.pointsViewers, { points: o.points, viewers: o.users });
      return {
        title: o.title, percent: o.percent, color: o.color || null, extra,
        lead: isPoll && !ended && most > 0 && o.votes === most,
        won: ended && !!o.won,
        lost: ended && someWon && !o.won,
      };
    });
    let footer;
    if (!ended) footer = isPoll ? votes(texts.pollFoot, texts.pollFootOne, view.total) : fill(texts.predictionFoot, { count: view.total });
    else if (view.result === 'canceled') footer = texts.cancelled || '';
    else if (view.result === 'none') footer = texts.noVotes || '';
    else if (view.result === 'tie') footer = texts.tie || '';
    else footer = isPoll ? votes(texts.votes, texts.voteOne, view.total) : '';
    return { kind: view.kind, label: isPoll ? texts.poll : texts.prediction, title: view.title, corner, rows, footer };
  }

  return { RESULT_MS, pick, render, clock };
}));
