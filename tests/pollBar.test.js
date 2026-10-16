'use strict';

// The Polls & predictions bar's model (public/overlay/pollModel.js), which the OBS page runs: what it shows and when,
// that it picks as the server's own rule does (services/pollRules.js), and that the page script puts Twitch's texts
// on the page only as text. Synthetic views only.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const model = require('../public/overlay/pollModel');
const rules = require('../src/services/pollRules');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const TEXTS = {
  poll: 'Poll', prediction: 'Prediction', locked: 'Locked', result: 'Result', votes: '{{count}} votes', voteOne: '{{count}} vote',
  pointsViewers: '{{points}} points · {{viewers}} viewers', pointsViewerOne: '{{points}} points · 1 viewer',
  pollFoot: '{{count}} votes · vote in the chat\'s poll box',
  pollFootOne: '{{count}} vote · vote in the chat\'s poll box',
  predictionFoot: '{{count}} points at stake', winners: '{{viewers}} viewers share {{points}} points',
  winnerOne: '1 viewer gets {{points}} points', tie: 'Tie',
  noVotes: 'No votes', cancelled: 'Cancelled — points refunded',
};
const OPTIONS = {
  poll: [
    { id: 'a', title: 'Yes', votes: 48, users: 0, points: 0, percent: 64, color: null, won: false },
    { id: 'b', title: 'No', votes: 27, users: 0, points: 0, percent: 36, color: null, won: false },
  ],
  prediction: [
    { id: 'a', title: 'Clean', votes: 0, users: 18, points: 12400, percent: 71, color: 'blue', won: false },
    { id: 'b', title: 'Chaos', votes: 0, users: 9, points: 5100, percent: 29, color: 'pink', won: false },
  ],
};
const view = (kind, over = {}) => ({
  kind, id: `${kind}-1`, title: `A ${kind}`, state: 'running', startedAt: NOW - 30000, endsAt: NOW + 90000, endedAt: null,
  result: null, options: OPTIONS[kind], total: kind === 'poll' ? 75 : 17500, users: kind === 'poll' ? 0 : 27, ...over,
});
const ended = (kind, at, result = 'won') => view(kind, {
  state: 'ended', endsAt: null, endedAt: at, result,
  options: OPTIONS[kind].map((o, i) => ({ ...o, won: result === 'won' ? i === 0 : result === 'tie' })),
});

describe('what the bar shows', () => {
  test('a running poll: its title, the time left, each choice with its percent and votes (the leader marked), the votes in all', () => {
    assert.deepEqual(model.render(view('poll'), NOW, TEXTS, 'en'), {
      kind: 'poll', label: 'Poll', title: 'A poll', corner: { type: 'time', text: '1:30' },
      rows: [
        { title: 'Yes', percent: 64, color: null, extra: '48 votes', lead: true, won: false, lost: false },
        { title: 'No', percent: 36, color: null, extra: '27 votes', lead: false, won: false, lost: false },
      ],
      footer: '75 votes · vote in the chat\'s poll box',
    });
  });

  test('a locked prediction: Locked in the corner, each outcome with its points and predictors, the points at stake', () => {
    const drawn = model.render(view('prediction', { state: 'locked', endsAt: null }), NOW, TEXTS, 'en');
    assert.deepEqual(drawn.corner, { type: 'locked', text: 'Locked' });
    assert.deepEqual(drawn.rows.map((r) => [r.title, r.extra, r.percent, r.color, r.lead]), [
      ['Clean', '12,400 points · 18 viewers', 71, 'blue', false],
      ['Chaos', '5,100 points · 9 viewers', 29, 'pink', false],
    ]);
    assert.equal(drawn.footer, '17,500 points at stake');
  });

  test('a result: the winner marked and the others faded; how many share the points; a tie, no votes, or cancelled said below', () => {
    const won = model.render(ended('prediction', NOW), NOW, TEXTS, 'en');
    assert.deepEqual(won.corner, { type: 'result', text: 'Result' });
    assert.deepEqual(won.rows.map((r) => [r.won, r.lost, r.extra]), [[true, false, '18 viewers share 17,500 points'], [false, true, '']]);
    assert.equal(won.footer, '');
    assert.equal(model.render(ended('poll', NOW), NOW, TEXTS, 'en').footer, '75 votes');
    const tie = model.render(ended('poll', NOW, 'tie'), NOW, TEXTS, 'en');
    assert.deepEqual(tie.rows.map((r) => [r.won, r.lost]), [[true, false], [true, false]]);
    assert.equal(tie.footer, 'Tie');
    assert.equal(model.render(ended('poll', NOW, 'none'), NOW, TEXTS, 'en').footer, 'No votes');
    assert.equal(model.render(ended('prediction', NOW, 'canceled'), NOW, TEXTS, 'en').footer, 'Cancelled — points refunded');
    assert.equal(model.render(null, NOW, TEXTS, 'en'), null);
  });

  test('exactly one vote reads as one: under a choice, in a running poll\'s total and in a result\'s; the plural without a singular text', () => {
    const options = [{ ...OPTIONS.poll[0], votes: 1, percent: 100 }, { ...OPTIONS.poll[1], votes: 0, percent: 0 }];
    const running = model.render(view('poll', { options, total: 1 }), NOW, TEXTS, 'en');
    assert.deepEqual(running.rows.map((r) => r.extra), ['1 vote', '0 votes']);
    assert.equal(running.footer, '1 vote · vote in the chat\'s poll box');
    const result = view('poll', { state: 'ended', endsAt: null, endedAt: NOW, result: 'won', options: options.map((o, i) => ({ ...o, won: i === 0 })), total: 1 });
    assert.equal(model.render(result, NOW, TEXTS, 'en').footer, '1 vote');
    const plural = { ...TEXTS };
    delete plural.voteOne;
    delete plural.pollFootOne;
    const older = model.render(view('poll', { options, total: 1 }), NOW, plural, 'en');
    assert.deepEqual([older.rows[0].extra, older.footer], ['1 votes', '1 votes · vote in the chat\'s poll box'], 'texts without the singular');
  });

  test('a prediction\'s winning outcome nobody picked: the row is marked, without a line under it', () => {
    const options = [{ ...OPTIONS.prediction[0], won: false }, { ...OPTIONS.prediction[1], users: 0, points: 0, percent: 0, won: true }];
    const drawn = model.render(view('prediction', { state: 'ended', endsAt: null, endedAt: NOW, result: 'won', options }), NOW, TEXTS, 'en');
    assert.deepEqual(drawn.rows.map((r) => [r.won, r.lost, r.extra]), [[false, true, ''], [true, false, '']]);
  });

  test('exactly one viewer reads as one: under a running outcome and under the winner; the plural without a singular text', () => {
    const options = [{ ...OPTIONS.prediction[0], users: 1, points: 300 }, OPTIONS.prediction[1]];
    const running = model.render(view('prediction', { options }), NOW, TEXTS, 'en');
    assert.deepEqual(running.rows.map((r) => r.extra), ['300 points · 1 viewer', '5,100 points · 9 viewers']);
    const won = options.map((o, i) => ({ ...o, won: i === 0 }));
    const result = view('prediction', { state: 'ended', endsAt: null, endedAt: NOW, result: 'won', options: won, total: 5400 });
    assert.equal(model.render(result, NOW, TEXTS, 'en').rows[0].extra, '1 viewer gets 5,400 points');
    const plural = { ...TEXTS };
    delete plural.pointsViewerOne;
    delete plural.winnerOne;
    assert.equal(model.render(view('prediction', { options }), NOW, plural, 'en').rows[0].extra, '300 points · 1 viewers', 'texts without the singular');
    assert.equal(model.render(result, NOW, plural, 'en').rows[0].extra, '1 viewers share 5,400 points');
  });

  test('a result shows for 10 seconds; with both on, the prediction; nothing otherwise', () => {
    assert.equal(model.pick({ poll: ended('poll', NOW - 9999), prediction: null }, NOW).kind, 'poll');
    assert.equal(model.pick({ poll: ended('poll', NOW - 10000), prediction: null }, NOW), null);
    assert.equal(model.pick({ poll: view('poll'), prediction: view('prediction') }, NOW).kind, 'prediction');
    assert.equal(model.pick({ poll: view('poll'), prediction: ended('prediction', NOW - 20000) }, NOW).kind, 'poll');
    assert.equal(model.pick(null, NOW), null);
  });

  test('the bar picks as the server does', () => {
    assert.equal(model.RESULT_MS, rules.BAR_RESULT_MS);
    const cases = [
      { poll: null, prediction: null },
      { poll: view('poll'), prediction: null },
      { poll: null, prediction: view('prediction', { state: 'locked' }) },
      { poll: view('poll'), prediction: view('prediction') },
      { poll: view('poll'), prediction: view('prediction', { state: 'locked', endsAt: null }) },
      { poll: view('poll'), prediction: ended('prediction', NOW - 5000) },
      { poll: ended('poll', NOW - 5000), prediction: ended('prediction', NOW - 12000) },
      { poll: ended('poll', NOW - 12000), prediction: null },
    ];
    for (const state of cases) assert.equal(model.pick(state, NOW), rules.pickBarView(state, NOW), JSON.stringify(state));
  });

  test('the time left counts down in m:ss, as the server writes it, and stops at 0:00', () => {
    assert.equal(model.clock(-1), '0:00');
    for (const ms of [1, 999, 59001, 90000, 600000, 1800000]) assert.equal(model.clock(ms), rules.formatClock(ms), String(ms));
  });
});

describe('the page script', () => {
  test('compiles, reads its own stream, and puts what Twitch sent on the page only as text', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'poll.js'), 'utf8');
    new vm.Script(source, { filename: 'poll.js' });
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.match(source, /\/overlay\/poll\/events\//);
  });
});
