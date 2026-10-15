'use strict';

// The Polls & predictions rules (services/pollRules.js) from synthetic Twitch answers: Helix's shapes (GET/POST/PATCH
// /polls, /predictions) and EventSub's (channel.poll.*, channel.prediction.*). No database, no Twitch.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('./pollRules');
const en = require('../locales/en.json');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('checkPollInput', () => {
  const poll = (over = {}) => ({ kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, ...over });
  const code = (input) => rules.checkPollInput(input).code;

  test('a poll and a prediction within the limits pass, cleaned', () => {
    assert.deepEqual(rules.checkPollInput(poll({ title: '  Top 5\nfinish?  ', choices: [' Yes ', 'No'] })),
      { ok: true, value: { kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null } });
    assert.deepEqual(rules.checkPollInput({ kind: 'prediction', title: 'Clean first lap?', choices: ['Clean', 'Chaos'], durationSeconds: '60', pointsPerVote: 5 }),
      { ok: true, value: { kind: 'prediction', title: 'Clean first lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60, pointsPerVote: null } }, 'a prediction has no points per vote');
    assert.equal(rules.checkPollInput(poll({ pointsPerVote: 250 })).value.pointsPerVote, 250);
  });

  test('every limit has its own code', () => {
    assert.equal(code(null), 'kind');
    assert.equal(code(poll({ kind: 'quiz' })), 'kind');
    assert.equal(code(poll({ title: '   ' })), 'title_required');
    assert.equal(code(poll({ title: 42 })), 'title_required');
    assert.equal(code(poll({ title: 'x'.repeat(61) })), 'title_long');
    assert.equal(rules.checkPollInput(poll({ title: 'x'.repeat(60) })).ok, true);
    assert.equal(code({ kind: 'prediction', title: 'x'.repeat(46), choices: ['a', 'b'], durationSeconds: 60 }), 'title_long');
    assert.equal(code(poll({ choices: ['only'] })), 'choices_count');
    assert.equal(code(poll({ choices: 'Yes,No' })), 'choices_count');
    assert.equal(code(poll({ choices: ['a', 'b', 'c', 'd', 'e', 'f'] })), 'choices_count');
    assert.equal(rules.checkPollInput({ kind: 'prediction', title: 'p', choices: Array.from({ length: 10 }, (_, i) => `o${i}`), durationSeconds: 60 }).ok, true);
    assert.equal(code({ kind: 'prediction', title: 'p', choices: Array.from({ length: 11 }, (_, i) => `o${i}`), durationSeconds: 60 }), 'choices_count');
    assert.equal(code(poll({ choices: ['Yes', ' '] })), 'choice_required');
    assert.equal(code(poll({ choices: ['Yes', 7] })), 'choice_required');
    assert.equal(code(poll({ choices: ['Yes', 'n'.repeat(26)] })), 'choice_long');
    assert.equal(code(poll({ durationSeconds: 14 })), 'duration');
    assert.equal(code(poll({ durationSeconds: 1801 })), 'duration');
    assert.equal(code(poll({ durationSeconds: 90.5 })), 'duration');
    assert.equal(code(poll({ durationSeconds: [120] })), 'duration');
    assert.equal(code({ kind: 'prediction', title: 'p', choices: ['a', 'b'], durationSeconds: 29 }), 'duration');
    assert.equal(code(poll({ pointsPerVote: 0 })), 'points');
    assert.equal(code(poll({ pointsPerVote: 1000001 })), 'points');
    assert.equal(code(poll({ pointsPerVote: 'many' })), 'points');
  });

  test('an emoji counts as one character, as Twitch counts it', () => {
    assert.equal(rules.checkPollInput(poll({ choices: ['🏁'.repeat(25), 'No'] })).ok, true);
    assert.equal(code(poll({ choices: ['🏁'.repeat(26), 'No'] })), 'choice_long');
    assert.equal(rules.checkPollInput(poll({ title: '🏁'.repeat(60) })).ok, true);
    assert.equal(code(poll({ title: '🏁'.repeat(61) })), 'title_long');
  });

  test('every code has a status and a text en.json has; the params name the limits', () => {
    for (const [code, error] of Object.entries(rules.ERRORS)) {
      assert.ok(Number.isInteger(error.status), code);
      assert.ok(Object.hasOwn(en, error.text), `${code}: ${error.text}`);
    }
    assert.deepEqual(rules.errorParams('title_long', 'prediction'), { max: 45 });
    assert.deepEqual(rules.errorParams('choices_count', 'poll'), { min: 2, max: 5 });
    assert.deepEqual(rules.errorParams('duration', 'prediction'), { min: 30, max: 1800 });
    assert.deepEqual(rules.errorParams('too_many'), { max: 20 });
    assert.deepEqual(rules.errorParams('running'), {});
  });
});

describe('normalizePoll', () => {
  test('a running Helix poll: the time it ends, votes and percentages', () => {
    const view = rules.normalizePoll({
      id: 'p1', title: 'Top 5?', status: 'ACTIVE', duration: 120, started_at: iso(NOW - 30000),
      choices: [{ id: 'c1', title: 'Yes', votes: 48 }, { id: 'c2', title: 'No', votes: 27 }],
    }, NOW);
    assert.equal(view.kind, 'poll');
    assert.equal(view.state, 'running');
    assert.equal(view.startedAt, NOW - 30000);
    assert.equal(view.endsAt, NOW + 90000);
    assert.equal(view.endedAt, null);
    assert.equal(view.result, null);
    assert.equal(view.total, 75);
    assert.deepEqual(view.options.map((o) => [o.title, o.votes, o.percent, o.won]), [['Yes', 48, 64, false], ['No', 27, 36, false]]);
  });

  test('EventSub begin (no votes yet, ends_at) and end (terminated, a tie)', () => {
    const begin = rules.normalizePoll({ id: 'p2', title: 'Car?', started_at: iso(NOW), ends_at: iso(NOW + 60000), choices: [{ id: 'a', title: 'GT3' }, { id: 'b', title: 'LMP2' }] }, NOW);
    assert.equal(begin.state, 'running');
    assert.equal(begin.endsAt, NOW + 60000);
    assert.deepEqual(begin.options.map((o) => o.votes), [0, 0]);
    const end = rules.normalizePoll({ id: 'p2', title: 'Car?', status: 'terminated', ended_at: iso(NOW + 5000), choices: [{ id: 'a', title: 'GT3', votes: 3 }, { id: 'b', title: 'LMP2', votes: 3 }] }, NOW);
    assert.equal(end.state, 'ended');
    assert.equal(end.endedAt, NOW + 5000);
    assert.equal(end.result, 'tie');
    assert.deepEqual(end.options.map((o) => o.won), [true, true]);
  });

  test('a poll nobody voted in, or one Twitch moderated, has no winner', () => {
    const none = rules.normalizePoll({ id: 'p3', title: 't', status: 'COMPLETED', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 0 }, { id: 'b', title: 'B', votes: 0 }] }, NOW);
    assert.equal(none.result, 'none');
    assert.deepEqual(none.options.map((o) => o.percent), [0, 0]);
    const moderated = rules.normalizePoll({ id: 'p4', title: 't', status: 'MODERATED', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 5 }, { id: 'b', title: 'B', votes: 1 }] }, NOW);
    assert.equal(moderated.result, 'none');
  });

  test('not a poll: null', () => {
    assert.equal(rules.normalizePoll(null, NOW), null);
    assert.equal(rules.normalizePoll({ id: 'x' }, NOW), null);
    assert.equal(rules.normalizePoll({ choices: [] }, NOW), null);
  });
});

describe('normalizePrediction', () => {
  const outcomes = [{ id: 'o1', title: 'Clean', color: 'BLUE', users: 18, channel_points: 12400 }, { id: 'o2', title: 'Chaos', color: 'PINK', users: 9, channel_points: 5100 }];

  test('EventSub begin, progress, lock and end (resolved and cancelled)', () => {
    const begin = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', started_at: iso(NOW), locks_at: iso(NOW + 60000), outcomes: [{ id: 'o1', title: 'Clean', color: 'blue' }, { id: 'o2', title: 'Chaos', color: 'pink' }] }, NOW);
    assert.equal(begin.state, 'running');
    assert.equal(begin.endsAt, NOW + 60000);
    assert.deepEqual(begin.options.map((o) => [o.color, o.points, o.users]), [['blue', 0, 0], ['pink', 0, 0]]);
    const progress = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', locks_at: iso(NOW + 60000), outcomes }, NOW);
    assert.equal(progress.total, 17500);
    assert.equal(progress.users, 27);
    assert.deepEqual(progress.options.map((o) => o.percent), [71, 29]);
    const locked = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', locked_at: iso(NOW + 60000), outcomes }, NOW);
    assert.equal(locked.state, 'locked');
    const won = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', status: 'resolved', winning_outcome_id: 'o1', ended_at: iso(NOW + 90000), outcomes }, NOW);
    assert.equal(won.state, 'ended');
    assert.equal(won.result, 'won');
    assert.deepEqual(won.options.map((o) => o.won), [true, false]);
    const canceled = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', status: 'canceled', ended_at: iso(NOW + 90000), outcomes }, NOW);
    assert.equal(canceled.result, 'canceled');
  });

  test('a Helix prediction: the window from its creation; LOCKED is locked; an unknown status is not one', () => {
    const active = rules.normalizePrediction({ id: 'r2', title: 't', status: 'ACTIVE', created_at: iso(NOW - 10000), prediction_window: 60, outcomes }, NOW);
    assert.equal(active.state, 'running');
    assert.equal(active.startedAt, NOW - 10000);
    assert.equal(active.endsAt, NOW + 50000);
    assert.equal(rules.normalizePrediction({ id: 'r2', title: 't', status: 'LOCKED', outcomes }, NOW).state, 'locked');
    assert.equal(rules.normalizePrediction({ id: 'r2', title: 't', status: 'WEIRD', outcomes }, NOW), null);
  });
});

describe('formatClock', () => {
  test('m:ss, rounded up, never below zero', () => {
    assert.equal(rules.formatClock(90000), '1:30');
    assert.equal(rules.formatClock(59001), '1:00');
    assert.equal(rules.formatClock(1), '0:01');
    assert.equal(rules.formatClock(-5000), '0:00');
    assert.equal(rules.formatClock(1800000), '30:00');
  });
});

describe('announcement', () => {
  const poll = (over) => rules.normalizePoll({ id: 'p', title: 'Top 5?', started_at: iso(NOW), ends_at: iso(NOW + 120000), choices: [{ id: 'a', title: 'Yes', votes: 48 }, { id: 'b', title: 'No', votes: 27 }], ...over }, NOW);
  const prediction = (over) => rules.normalizePrediction({ id: 'r', title: 'Clean lap?', locks_at: iso(NOW + 60000), outcomes: [{ id: 'o1', title: 'Clean', users: 18, channel_points: 12400 }, { id: 'o2', title: 'Chaos', users: 9, channel_points: 5100 }], ...over }, NOW);

  test('a poll: the start with its time, the result with the winner', () => {
    assert.deepEqual(rules.announcement(poll(), 'start', NOW), { textKey: 'poll_start_template', values: { title: 'Top 5?', time: '2:00' } });
    assert.deepEqual(rules.announcement(poll({ status: 'completed', ended_at: iso(NOW) }), 'end', NOW),
      { textKey: 'poll_end_template', values: { title: 'Top 5?', winner: 'Yes', percent: 64, votes: 48 } });
    assert.equal(rules.announcement(poll(), 'lock', NOW), null, 'a poll has no lock');
  });

  test('a tie names every tied choice; no votes, no result line', () => {
    const tie = poll({ status: 'completed', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 2 }, { id: 'b', title: 'B', votes: 2 }] });
    assert.equal(rules.announcement(tie, 'end', NOW).values.winner, 'A / B');
    const none = poll({ status: 'completed', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 0 }, { id: 'b', title: 'B', votes: 0 }] });
    assert.equal(rules.announcement(none, 'end', NOW), null);
  });

  test('a prediction: start, lock, result and cancel', () => {
    assert.deepEqual(rules.announcement(prediction(), 'start', NOW), { textKey: 'prediction_start_template', values: { title: 'Clean lap?', time: '1:00' } });
    assert.deepEqual(rules.announcement(prediction({ locked_at: iso(NOW) }), 'lock', NOW), { textKey: 'prediction_lock_template', values: { title: 'Clean lap?' } });
    assert.deepEqual(rules.announcement(prediction({ status: 'resolved', winning_outcome_id: 'o1', ended_at: iso(NOW) }), 'end', NOW),
      { textKey: 'prediction_end_template', values: { title: 'Clean lap?', outcome: 'Clean', winners: 18, points: 17500 } });
    assert.deepEqual(rules.announcement(prediction({ status: 'canceled', ended_at: iso(NOW) }), 'end', NOW),
      { textKey: 'prediction_cancel_template', values: { title: 'Clean lap?' } });
  });

  test('the six texts are the six columns, each with its label and variables', () => {
    assert.deepEqual(rules.CHAT_TEXTS.map((c) => c.key), ['poll_start_template', 'poll_end_template', 'prediction_start_template', 'prediction_lock_template', 'prediction_end_template', 'prediction_cancel_template']);
    for (const c of rules.CHAT_TEXTS) assert.ok(Object.hasOwn(en, c.label), c.label);
  });
});

describe('what the card and the bar show', () => {
  const ended = (kind, at) => ({ kind, id: kind, title: kind, state: 'ended', startedAt: null, endsAt: null, endedAt: at, result: 'won', options: [], total: 0, users: 0 });
  const running = (kind) => ({ ...ended(kind, null), state: 'running', endedAt: null, result: null });

  test('the card shows a result for 30 seconds, the bar for 10', () => {
    assert.equal(rules.onCard(ended('poll', NOW - 29000), NOW), true);
    assert.equal(rules.onCard(ended('poll', NOW - 30000), NOW), false);
    assert.equal(rules.onCard(running('poll'), NOW), true);
    assert.equal(rules.onCard(null, NOW), false);
    assert.equal(rules.pickBarView({ poll: ended('poll', NOW - 9000), prediction: null }, NOW).kind, 'poll');
    assert.equal(rules.pickBarView({ poll: ended('poll', NOW - 10000), prediction: null }, NOW), null);
  });

  test('with both on the bar, the prediction is shown', () => {
    assert.equal(rules.pickBarView({ poll: running('poll'), prediction: running('prediction') }, NOW).kind, 'prediction');
    assert.equal(rules.pickBarView({ poll: running('poll'), prediction: ended('prediction', NOW - 20000) }, NOW).kind, 'poll');
    assert.equal(rules.pickBarView({ poll: null, prediction: null }, NOW), null);
  });
});
