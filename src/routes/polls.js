'use strict';

// The Polls & predictions card's JSON routes, mounted inside the dashboard router (behind its login, the
// disabled-account check and CSRF): the saved templates; the buttons that start, end, lock, resolve or cancel Twitch's
// poll or prediction; the live view the card polls; and "Check again" after Twitch refused for not being an
// Affiliate. Each answers { ok: true, … } or { ok: false, code, error } with the text of pollRules.ERRORS. A button's
// answer carries what Twitch did at once (livePolls.setFromTwitch); Twitch's events follow a moment later.

const express = require('express');
const db = require('../db');
const rules = require('../services/pollRules');
const twitchPolls = require('../services/twitchPolls');
const { livePolls } = require('../services/livePolls');
const { hasPollsScope } = require('../services/twitch');
const { pollsStatus, pollsSetup } = require('../services/dashboardCards');

const router = express.Router();

// A Twitch poll, prediction or outcome id, as the card sends it back.
const TWITCH_ID = /^[A-Za-z0-9-]{1,64}$/;
const twitchId = (value) => (typeof value === 'string' && TWITCH_ID.test(value) ? value : null);

function refuse(res, code, kind) {
  const error = rules.ERRORS[code] || rules.ERRORS.twitch_failed;
  res.status(error.status).json({ ok: false, code, error: res.locals.t(error.text, rules.errorParams(code, kind)) });
}

// The Twitch buttons and the live view: without the two permissions they ask for a reconnect, and Twitch is not asked.
function needsPermissions(req, res, next) {
  if (hasPollsScope(req.streamer)) return next();
  refuse(res, 'needs_reconnect');
}

// What runs, as the card shows it: the views and the card's status line, by the card's own rule (its setup step
// first, so after Twitch's not-Affiliate refusal the line keeps saying so).
function liveAnswer(req, res, live) {
  const setup = pollsSetup(req.streamer, hasPollsScope(req.streamer));
  const st = pollsStatus(live, db.countPollTemplates(req.streamer.id), setup);
  return { ...live, status: { text: res.locals.t(st.key, st.params), tone: st.tone } };
}

// One of the card's Twitch buttons: Twitch's answer is shown at once and announced once (`phase`), and the card gets
// the live state back. A refusal answers its code; Twitch's message is logged, never shown.
async function act(req, res, kind, phase, call) {
  try {
    livePolls.setFromTwitch(req.streamer.id, kind, await call(), phase);
  } catch (err) {
    if (!(err instanceof twitchPolls.PollsError)) throw err;
    console.warn(`[Polls] Twitch refused a ${kind} ${phase} for streamer ${req.streamer.id}: ${err.message}`);
    return refuse(res, err.code, kind);
  }
  res.json({ ok: true, live: liveAnswer(req, res, livePolls.snapshot(req.streamer.id)) });
}

// ── Templates ──

router.post('/api/poll-templates', (req, res) => {
  const checked = rules.checkPollInput(req.body);
  if (!checked.ok) return refuse(res, checked.code, req.body && req.body.kind);
  if (db.countPollTemplates(req.streamer.id) >= rules.TEMPLATES_MAX) return refuse(res, 'too_many');
  res.status(201).json({ ok: true, template: db.addPollTemplate(req.streamer.id, checked.value) });
});

// An edit names only what changes; the rest stays as saved.
router.patch('/api/poll-templates/:id', (req, res) => {
  const template = db.getPollTemplate(Number(req.params.id), req.streamer.id);
  if (!template) return refuse(res, 'not_found');
  const merged = { ...template, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  const checked = rules.checkPollInput(merged);
  if (!checked.ok) return refuse(res, checked.code, merged.kind);
  db.updatePollTemplate(template.id, req.streamer.id, checked.value);
  res.json({ ok: true, template: db.getPollTemplate(template.id, req.streamer.id) });
});

router.delete('/api/poll-templates/:id', (req, res) => {
  if (!db.deletePollTemplate(Number(req.params.id), req.streamer.id)) return refuse(res, 'not_found');
  res.json({ ok: true });
});

// ── Twitch ──

const starting = new Set(); // `${streamerId}:${kind}` while a start waits for Twitch: a second click is refused

// { templateId } starts a saved template; a one-off's fields ({ kind, title, choices, … }) start it unsaved.
router.post('/api/polls/start', needsPermissions, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let input = body;
  if (body.templateId !== undefined) {
    input = db.getPollTemplate(Number(body.templateId), req.streamer.id);
    if (!input) return refuse(res, 'not_found');
  }
  const checked = rules.checkPollInput(input);
  if (!checked.ok) return refuse(res, checked.code, input.kind);
  const { value } = checked;
  const shown = livePolls.snapshot(req.streamer.id)[value.kind];
  const key = `${req.streamer.id}:${value.kind}`;
  if ((shown && shown.state !== 'ended') || starting.has(key)) return refuse(res, 'running');
  starting.add(key);
  try {
    await act(req, res, value.kind, 'start', () => (value.kind === 'poll'
      ? twitchPolls.createPoll(req.streamer, value)
      : twitchPolls.createPrediction(req.streamer, value)));
  } finally {
    starting.delete(key);
  }
});

router.post('/api/polls/end', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  if (!id) return refuse(res, 'invalid');
  await act(req, res, 'poll', 'end', () => twitchPolls.endPoll(req.streamer, id));
});

router.post('/api/predictions/lock', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  if (!id) return refuse(res, 'invalid');
  await act(req, res, 'prediction', 'lock', () => twitchPolls.lockPrediction(req.streamer, id));
});

router.post('/api/predictions/resolve', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  const outcomeId = twitchId((req.body || {}).outcomeId);
  if (!id || !outcomeId) return refuse(res, 'invalid');
  await act(req, res, 'prediction', 'end', () => twitchPolls.resolvePrediction(req.streamer, id, outcomeId));
});

// Cancel and refund: Twitch gives every viewer their points back.
router.post('/api/predictions/cancel', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  if (!id) return refuse(res, 'invalid');
  await act(req, res, 'prediction', 'end', () => twitchPolls.cancelPrediction(req.streamer, id));
});

// What the card shows: the running and just-ended poll and prediction (titles, choices, votes, points, times).
router.get('/api/polls/live', needsPermissions, async (req, res) => {
  let live;
  try {
    live = await livePolls.live(req.streamer.id);
  } catch (err) {
    if (err && err.code === 'needs_reconnect') return refuse(res, 'needs_reconnect');
    throw err;
  }
  res.json({ ok: true, ...liveAnswer(req, res, live) });
});

// "Check again" on the card that says Twitch refused for not being an Affiliate or Partner: that answer (the flag the
// rewards card reads too) is forgotten, so the card offers its buttons again; Twitch refuses the next start if nothing
// changed.
router.post('/api/polls/affiliate-check', (req, res) => {
  db.updateStreamerCpSync(req.streamer.id, { affiliate_status: null });
  res.json({ ok: true });
});

module.exports = router;
