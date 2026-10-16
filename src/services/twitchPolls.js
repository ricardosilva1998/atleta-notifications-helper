'use strict';

// Twitch's polls and predictions for a streamer (Helix, with the streamer's broadcaster token): start, end, lock,
// resolve, cancel, and the newest of each. A stored token past its expiry is refreshed before the request, and a token
// Twitch refuses is refreshed once, through the refresh the follow checks share (twitch.refreshBroadcasterTokenShared:
// one at a time per streamer); one refresh per call at most. A call has one deadline, 15 seconds for the request, a
// refresh and the request again together (each request still has its own 10); past it the caller stops waiting (a
// refresh goes on with its own timeout). Twitch's refusals become the codes the Polls & predictions card shows
// (PollsError.code; their texts are pollRules.ERRORS):
//   needs_reconnect  no linked channel or token, the two permissions missing, a token Twitch refuses twice, or a grant
//                    Twitch no longer accepts (the shared refresh clears its permissions)
//   not_affiliate    Twitch allows polls and predictions to Affiliates and Partners only: recognised by the message,
//                    since Twitch documents no status for it; the flag the rewards card reads is stored, and a start
//                    that works sets it back to 'ok' (the rewards client's value)
//   running          a start while one of the same kind runs
//   automod          a title or choice Twitch's AutoMod refused
//   changed          an end, lock, result or cancel of one whose status changed meanwhile
//   not_found        a prediction or outcome Twitch does not know
//   refused          any other refusal (a 4xx): it would come again, so the card asks to check the question, the
//                    choices and the channel's settings (Twitch's message is logged by the route, never shown)
//   twitch_failed    no answer in time (a request's 10 seconds, the call's 15), no network, a token refresh that
//                    failed for a moment, too many requests (429) or a server error (5xx)

const config = require('../config');
const db = require('../db');
const { refreshBroadcasterTokenShared, hasPollsScope } = require('./twitch');

const HELIX_BASE = 'https://api.twitch.tv/helix';
const HELIX_TIMEOUT_MS = 10_000;
const CALL_DEADLINE_MS = 15_000; // the whole call: the request, a token refresh and the request again

// Settles like `promise`, or rejects once `signal` aborts: the caller stops waiting for a refresh other callers share,
// which goes on with its own timeout.
function beforeDeadline(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

class PollsError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

function codeFor(status, message, creating) {
  const text = String(message || '').toLowerCase();
  if (/affiliate|partner/.test(text)) return 'not_affiliate';
  if (status === 401) return 'needs_reconnect';
  if (status === 404) return 'not_found';
  if (status === 400 && /automod/.test(text)) return 'automod';
  if (status === 400 && creating && /already/.test(text)) return 'running';
  if (status === 400 && !creating && /must be active|current status/.test(text)) return 'changed';
  if (status >= 400 && status < 500 && status !== 429) return 'refused';
  return 'twitch_failed';
}

async function helix(streamer, method, urlPath, body, { creating = false } = {}) {
  if (!streamer || !streamer.twitch_user_id || !streamer.broadcaster_access_token || !hasPollsScope(streamer)) {
    throw new PollsError('needs_reconnect');
  }
  const deadline = AbortSignal.timeout(CALL_DEADLINE_MS);
  const send = (token) => fetch(`${HELIX_BASE}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.twitch.clientId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([AbortSignal.timeout(HELIX_TIMEOUT_MS), deadline]),
  });
  const refresh = async () => {
    try {
      return await beforeDeadline(refreshBroadcasterTokenShared(streamer), deadline);
    } catch (err) {
      // Only a grant Twitch no longer accepts asks for a reconnect (the shared refresh has cleared the permissions);
      // a refresh that failed for a moment (a 5xx or a 429, no answer, no network) is Twitch failing this once.
      if (err && err.code === 'INVALID_REFRESH_TOKEN') throw new PollsError('needs_reconnect', err.message);
      throw new PollsError('twitch_failed', err && err.message);
    }
  };
  let res;
  try {
    // A token past its expiry is refreshed first (no 401 round trip); one Twitch refuses is refreshed once.
    const expired = !!streamer.broadcaster_token_expires_at && Date.now() >= streamer.broadcaster_token_expires_at;
    res = await send(expired ? await refresh() : streamer.broadcaster_access_token);
    if (res.status === 401 && !expired) res = await send(await refresh());
  } catch (err) {
    if (err instanceof PollsError) throw err;
    throw new PollsError('twitch_failed', err && err.message);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = codeFor(res.status, data && data.message, creating);
    if (code === 'not_affiliate') db.updateStreamerCpSync(streamer.id, { affiliate_status: 'not_affiliate' });
    throw new PollsError(code, `${res.status} ${(data && data.message) || ''}`.trim());
  }
  if (creating && streamer.cp_affiliate_status === 'not_affiliate') db.updateStreamerCpSync(streamer.id, { affiliate_status: 'ok' });
  return data;
}

const first = (data) => (data && Array.isArray(data.data) && data.data[0]) || null;
const own = (streamer) => encodeURIComponent(streamer && streamer.twitch_user_id);

// `value` is pollRules.checkPollInput()'s.
async function createPoll(streamer, value) {
  const body = { broadcaster_id: streamer.twitch_user_id, title: value.title, choices: value.choices.map((title) => ({ title })), duration: value.durationSeconds };
  if (value.pointsPerVote) {
    body.channel_points_voting_enabled = true;
    body.channel_points_per_vote = value.pointsPerVote;
  }
  return first(await helix(streamer, 'POST', '/polls', body, { creating: true }));
}

// Ends a poll now; it stays visible in the channel with its result (TERMINATED, not ARCHIVED).
async function endPoll(streamer, pollId) {
  return first(await helix(streamer, 'PATCH', '/polls', { broadcaster_id: streamer.twitch_user_id, id: pollId, status: 'TERMINATED' }));
}

async function latestPoll(streamer) {
  return first(await helix(streamer, 'GET', `/polls?broadcaster_id=${own(streamer)}&first=1`));
}

async function createPrediction(streamer, value) {
  return first(await helix(streamer, 'POST', '/predictions', {
    broadcaster_id: streamer.twitch_user_id, title: value.title, outcomes: value.choices.map((title) => ({ title })), prediction_window: value.durationSeconds,
  }, { creating: true }));
}

async function lockPrediction(streamer, predictionId) {
  return first(await helix(streamer, 'PATCH', '/predictions', { broadcaster_id: streamer.twitch_user_id, id: predictionId, status: 'LOCKED' }));
}

async function resolvePrediction(streamer, predictionId, outcomeId) {
  return first(await helix(streamer, 'PATCH', '/predictions', { broadcaster_id: streamer.twitch_user_id, id: predictionId, status: 'RESOLVED', winning_outcome_id: outcomeId }));
}

// Cancels a prediction: Twitch gives every viewer their points back.
async function cancelPrediction(streamer, predictionId) {
  return first(await helix(streamer, 'PATCH', '/predictions', { broadcaster_id: streamer.twitch_user_id, id: predictionId, status: 'CANCELED' }));
}

async function latestPrediction(streamer) {
  return first(await helix(streamer, 'GET', `/predictions?broadcaster_id=${own(streamer)}&first=1`));
}

module.exports = {
  PollsError, CALL_DEADLINE_MS, createPoll, endPoll, latestPoll, createPrediction, lockPrediction, resolvePrediction,
  cancelPrediction, latestPrediction,
};
