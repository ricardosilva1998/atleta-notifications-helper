'use strict';

// The rules of the Polls & predictions card: Twitch's limits, the check of a template or a one-off, what a Twitch poll
// or prediction looks like on the card, on the on-stream bar and in the bot's lines. Pure: nothing here reads the
// database or asks Twitch (pollRules.test.js tests every rule on its own). A **view** is one poll or prediction as the
// card, the bar and the bot read it:
//   { kind: 'poll'|'prediction', id, title, state: 'running'|'locked'|'ended', startedAt, endsAt, endedAt (ms or null),
//     result: 'won'|'tie'|'none'|'canceled'|null, options: [{ id, title, votes, users, points, percent, color, won }],
//     total (votes, or points for a prediction), users (a prediction's predictors) }

const { singleLine } = require('./chatCommands');

// Twitch's limits (Helix Create Poll and Create Prediction).
const LIMITS = Object.freeze({
  poll: Object.freeze({ titleMax: 60, choiceMax: 25, minChoices: 2, maxChoices: 5, minSeconds: 15, maxSeconds: 1800 }),
  prediction: Object.freeze({ titleMax: 45, choiceMax: 25, minChoices: 2, maxChoices: 10, minSeconds: 30, maxSeconds: 1800 }),
});
const POINTS_PER_VOTE = Object.freeze({ min: 1, max: 1000000 });
const TEMPLATES_MAX = 20;
// The times the template pop-up offers (a value saved earlier outside the list stays selectable).
const DURATION_CHOICES = Object.freeze({
  poll: Object.freeze([30, 60, 120, 180, 300, 600]),
  prediction: Object.freeze([60, 120, 300, 600, 1800]),
});
const CARD_RESULT_MS = 30000; // the card shows a result this long
const BAR_RESULT_MS = 10000; // the on-stream bar shows a result this long

// The bot's six lines: their streamers column, their label in the chat messages pop-up and their variables.
const CHAT_TEXTS = Object.freeze([
  Object.freeze({ key: 'poll_start_template', label: 'cards.polls.texts.pollStart', vars: Object.freeze(['{title}', '{time}']) }),
  Object.freeze({ key: 'poll_end_template', label: 'cards.polls.texts.pollEnd', vars: Object.freeze(['{title}', '{winner}', '{percent}', '{votes}']) }),
  Object.freeze({ key: 'prediction_start_template', label: 'cards.polls.texts.predictionStart', vars: Object.freeze(['{title}', '{time}']) }),
  Object.freeze({ key: 'prediction_lock_template', label: 'cards.polls.texts.predictionLock', vars: Object.freeze(['{title}']) }),
  Object.freeze({ key: 'prediction_end_template', label: 'cards.polls.texts.predictionEnd', vars: Object.freeze(['{title}', '{outcome}', '{winners}', '{points}']) }),
  Object.freeze({ key: 'prediction_cancel_template', label: 'cards.polls.texts.predictionCancel', vars: Object.freeze(['{title}']) }),
]);

// A refusal's HTTP status and text (routes/polls.js answers it translated, with errorParams()).
const ERRORS = Object.freeze({
  kind: Object.freeze({ status: 400, text: 'cards.polls.error.kind' }),
  title_required: Object.freeze({ status: 400, text: 'cards.polls.error.titleRequired' }),
  title_long: Object.freeze({ status: 400, text: 'cards.polls.error.titleLong' }),
  choices_count: Object.freeze({ status: 400, text: 'cards.polls.error.choicesCount' }),
  choice_required: Object.freeze({ status: 400, text: 'cards.polls.error.choiceRequired' }),
  choice_long: Object.freeze({ status: 400, text: 'cards.polls.error.choiceLong' }),
  duration: Object.freeze({ status: 400, text: 'cards.polls.error.duration' }),
  points: Object.freeze({ status: 400, text: 'cards.polls.error.points' }),
  invalid: Object.freeze({ status: 400, text: 'dashboard.settings.error.invalid' }),
  not_found: Object.freeze({ status: 404, text: 'dashboard.settings.error.notFound' }),
  too_many: Object.freeze({ status: 409, text: 'cards.polls.error.tooMany' }),
  running: Object.freeze({ status: 409, text: 'cards.polls.error.running' }),
  changed: Object.freeze({ status: 409, text: 'cards.polls.error.changed' }),
  automod: Object.freeze({ status: 400, text: 'cards.polls.error.automod' }),
  refused: Object.freeze({ status: 400, text: 'cards.polls.error.refused' }),
  not_affiliate: Object.freeze({ status: 409, text: 'cards.polls.error.notAffiliate' }),
  needs_reconnect: Object.freeze({ status: 409, text: 'cards.polls.error.reconnect' }),
  twitch_failed: Object.freeze({ status: 502, text: 'cards.polls.error.twitchFailed' }),
});

// The numbers a refusal's text names.
function errorParams(code, kind) {
  const limits = LIMITS[kind] || LIMITS.poll;
  switch (code) {
    case 'title_long': return { max: limits.titleMax };
    case 'choices_count': return { min: limits.minChoices, max: limits.maxChoices };
    case 'choice_long': return { max: limits.choiceMax };
    case 'duration': return { min: limits.minSeconds, max: limits.maxSeconds };
    case 'points': return { min: POINTS_PER_VOTE.min, max: POINTS_PER_VOTE.max };
    case 'too_many': return { max: TEMPLATES_MAX };
    default: return {};
  }
}

const characters = (text) => Array.from(text).length; // an emoji counts once, as Twitch counts it
const cleanText = (value) => (typeof value === 'string' ? singleLine(value).trim() : null);
const isNumberLike = (value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');

// A template or a one-off from a request body ({ kind, title, choices, durationSeconds, pointsPerVote }), checked
// against Twitch's limits: { ok: true, value } with the texts cleaned, or { ok: false, code }.
function checkPollInput(input) {
  const body = input && typeof input === 'object' ? input : {};
  const kind = body.kind;
  if (kind !== 'poll' && kind !== 'prediction') return { ok: false, code: 'kind' };
  const limits = LIMITS[kind];
  const title = cleanText(body.title);
  if (!title) return { ok: false, code: 'title_required' };
  if (characters(title) > limits.titleMax) return { ok: false, code: 'title_long' };
  if (!Array.isArray(body.choices) || body.choices.length < limits.minChoices || body.choices.length > limits.maxChoices) {
    return { ok: false, code: 'choices_count' };
  }
  const choices = body.choices.map(cleanText);
  if (choices.some((choice) => !choice)) return { ok: false, code: 'choice_required' };
  if (choices.some((choice) => characters(choice) > limits.choiceMax)) return { ok: false, code: 'choice_long' };
  const seconds = isNumberLike(body.durationSeconds) ? Number(body.durationSeconds) : NaN;
  if (!Number.isInteger(seconds) || seconds < limits.minSeconds || seconds > limits.maxSeconds) return { ok: false, code: 'duration' };
  let pointsPerVote = null;
  if (kind === 'poll' && body.pointsPerVote !== null && body.pointsPerVote !== undefined && body.pointsPerVote !== '') {
    const points = isNumberLike(body.pointsPerVote) ? Number(body.pointsPerVote) : NaN;
    if (!Number.isInteger(points) || points < POINTS_PER_VOTE.min || points > POINTS_PER_VOTE.max) return { ok: false, code: 'points' };
    pointsPerVote = points;
  }
  return { ok: true, value: { kind, title, choices, durationSeconds: seconds, pointsPerVote } };
}

const toMs = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const amount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const percentages = (amounts) => {
  const total = amounts.reduce((sum, n) => sum + n, 0);
  return amounts.map((n) => (total > 0 ? Math.round((n / total) * 100) : 0));
};

// A Twitch poll — Helix's (status ACTIVE, COMPLETED, TERMINATED, ARCHIVED, MODERATED, INVALID; started_at and duration)
// or an EventSub event's (begin and progress: ends_at, no status; end: status completed, terminated or archived) — as
// a view; null when it is not one.
function normalizePoll(src, now) {
  if (!src || typeof src !== 'object' || !src.id || !Array.isArray(src.choices)) return null;
  const status = String(src.status || '').toLowerCase();
  const running = status ? status === 'active' : !src.ended_at;
  const options = src.choices.map((c) => ({ id: String((c && c.id) || ''), title: String((c && c.title) || ''), votes: amount(c && c.votes), users: 0, points: 0, color: null, percent: 0, won: false }));
  percentages(options.map((o) => o.votes)).forEach((p, i) => { options[i].percent = p; });
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  let endsAt = toMs(src.ends_at);
  const startedAt = toMs(src.started_at);
  if (endsAt === null && startedAt !== null && Number.isFinite(Number(src.duration))) endsAt = startedAt + Number(src.duration) * 1000;
  let result = null;
  if (!running) {
    const most = Math.max(0, ...options.map((o) => o.votes));
    const winners = total > 0 && !['moderated', 'invalid'].includes(status) ? options.filter((o) => o.votes === most) : [];
    for (const o of winners) o.won = true;
    result = winners.length === 0 ? 'none' : winners.length > 1 ? 'tie' : 'won';
  }
  return {
    kind: 'poll', id: String(src.id), title: String(src.title || ''), state: running ? 'running' : 'ended', startedAt,
    endsAt: running ? endsAt : null, endedAt: running ? null : (toMs(src.ended_at) ?? now), result, options, total, users: 0,
  };
}

// A Twitch prediction — Helix's (status ACTIVE, LOCKED, RESOLVED, CANCELED; created_at and prediction_window) or an
// EventSub event's (begin and progress: locks_at; lock: locked_at; end: status resolved or canceled) — as a view; null
// when it is not one.
function normalizePrediction(src, now) {
  if (!src || typeof src !== 'object' || !src.id || !Array.isArray(src.outcomes)) return null;
  const status = String(src.status || '').toLowerCase();
  let state;
  if (status === 'active') state = 'running';
  else if (status === 'locked') state = 'locked';
  else if (status === 'resolved' || status === 'canceled') state = 'ended';
  else if (!status) state = src.locked_at ? 'locked' : 'running';
  else return null;
  const winningId = src.winning_outcome_id ? String(src.winning_outcome_id) : null;
  const options = src.outcomes.map((o) => ({
    id: String((o && o.id) || ''), title: String((o && o.title) || ''), votes: 0,
    users: amount(o && o.users), points: amount(o && o.channel_points),
    color: String((o && o.color) || '').toLowerCase() === 'pink' ? 'pink' : 'blue', percent: 0,
    won: state === 'ended' && status === 'resolved' && !!winningId && String((o && o.id) || '') === winningId,
  }));
  percentages(options.map((o) => o.points)).forEach((p, i) => { options[i].percent = p; });
  let endsAt = toMs(src.locks_at);
  const createdAt = toMs(src.created_at) ?? toMs(src.started_at);
  if (endsAt === null && createdAt !== null && Number.isFinite(Number(src.prediction_window))) endsAt = createdAt + Number(src.prediction_window) * 1000;
  let result = null;
  if (state === 'ended') result = status === 'canceled' ? 'canceled' : options.some((o) => o.won) ? 'won' : 'none';
  return {
    kind: 'prediction', id: String(src.id), title: String(src.title || ''), state, startedAt: createdAt,
    endsAt: state === 'running' ? endsAt : null, endedAt: state === 'ended' ? (toMs(src.ended_at) ?? now) : null,
    result, options, total: options.reduce((sum, o) => sum + o.points, 0), users: options.reduce((sum, o) => sum + o.users, 0),
  };
}

// 90000 → '1:30': whole seconds rounded up, never below zero.
function formatClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// The bot's line for a moment of a poll or prediction ('start', 'lock', 'end'): the column of the streamer's text and
// the values it is filled with, or null when nothing is said (a poll's lock; a result without votes or winner).
function announcement(view, phase, now) {
  if (!view) return null;
  const time = view.endsAt === null ? '' : formatClock(view.endsAt - now);
  if (view.kind === 'poll') {
    if (phase === 'start') return { textKey: 'poll_start_template', values: { title: view.title, time } };
    if (phase !== 'end' || (view.result !== 'won' && view.result !== 'tie')) return null;
    const winners = view.options.filter((o) => o.won);
    return { textKey: 'poll_end_template', values: { title: view.title, winner: winners.map((o) => o.title).join(' / '), percent: winners[0].percent, votes: winners[0].votes } };
  }
  if (phase === 'start') return { textKey: 'prediction_start_template', values: { title: view.title, time } };
  if (phase === 'lock') return { textKey: 'prediction_lock_template', values: { title: view.title } };
  if (phase !== 'end') return null;
  if (view.result === 'canceled') return { textKey: 'prediction_cancel_template', values: { title: view.title } };
  const winner = view.options.find((o) => o.won);
  if (!winner) return null;
  return { textKey: 'prediction_end_template', values: { title: view.title, outcome: winner.title, winners: winner.users, points: view.total } };
}

const recent = (view, now, ms) => !!view && (view.state !== 'ended' || (view.endedAt !== null && now - view.endedAt < ms));

// Whether the card still shows a view: running, locked, or ended less than 30 seconds ago.
const onCard = (view, now) => recent(view, now, CARD_RESULT_MS);

// What the on-stream bar shows: the prediction (points at stake), else the poll; a result for 10 seconds; or nothing.
function pickBarView({ poll, prediction } = {}, now) {
  if (recent(prediction, now, BAR_RESULT_MS)) return prediction;
  if (recent(poll, now, BAR_RESULT_MS)) return poll;
  return null;
}

module.exports = {
  LIMITS, POINTS_PER_VOTE, TEMPLATES_MAX, DURATION_CHOICES, CARD_RESULT_MS, BAR_RESULT_MS, CHAT_TEXTS, ERRORS,
  errorParams, checkPollInput, normalizePoll, normalizePrediction, formatClock, announcement, onCard, pickBarView,
};
