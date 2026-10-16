'use strict';

// ElevenLabs client for reading tips aloud: text to speech (synthesize) and the
// characters left on the account (remainingCredits). Every call takes its
// fetch, key and model as options so the tests never touch the network; the
// defaults come from config.tts, read only when a call needs them. The key goes
// out in one header and is never put in an error or a log line.

const API = 'https://api.elevenlabs.io/v1';
const CREDITS_TTL_MS = 10 * 60 * 1000;
const CREDITS_TIMEOUT_MS = 10 * 1000;
const CREDITS_LOG_INTERVAL_MS = 60 * 60 * 1000; // a failing credits read is logged at most once an hour

const SIMILARITY_BOOST = 0.75;

const round2 = (n) => Math.round(n * 100) / 100;

function ttsConfig() {
  return require('../config').tts;
}

// expressiveness 0-1: 0 is steady and even, 1 the livelier delivery (lower stability, more style).
function voiceSettings(speed, expressiveness) {
  return {
    stability: round2(0.85 - 0.6 * expressiveness),
    similarity_boost: SIMILARITY_BOOST,
    style: round2(0.6 * expressiveness),
    speed,
    use_speaker_boost: true,
  };
}

async function synthesize({ voiceId, text, speed, expressiveness, lang }, options = {}) {
  const {
    fetch = globalThis.fetch,
    apiKey = ttsConfig().apiKey,
    model = ttsConfig().model,
    timeoutMs = 15000,
  } = options;
  if (!apiKey) throw new Error('no_key');

  let res;
  try {
    res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, language_code: lang, voice_settings: voiceSettings(speed, expressiveness) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`elevenlabs_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    // A refusal keeps its status; a network failure or a timeout becomes one code, so no detail of the request travels.
    if (/^elevenlabs_\d+$/.test(err && err.message)) throw err;
    throw new Error('elevenlabs_failed');
  }
}

// The last good value and when the last read was tried, good or not (module state; resetCredits is for the tests).
let credits = { value: null, at: null };
let creditsLoggedAt = null;

function resetCredits() {
  credits = { value: null, at: null };
  creditsLoggedAt = null;
}

// A key that cannot read /v1/user/subscription (a 401: it lacks the user permission) leaves the credit floor
// silently off, so the failure is logged: the status, or "failed" for a network error, a timeout or an unreadable
// answer. Never the key; at most once an hour.
function logCreditsFailure(log, t, reason) {
  if (creditsLoggedAt !== null && t - creditsLoggedAt < CREDITS_LOG_INTERVAL_MS) return;
  creditsLoggedAt = t;
  log.error(`[TTS] Credits read failed: ${reason}`);
}

// Characters left this billing period (limit minus used), read at most every 10 minutes.
// A failed read answers the last value known, null when there is none, and waits just as long
// before the next try, so a slow or refusing ElevenLabs is asked once per 10 minutes, not once per tip.
async function remainingCredits({ fetch = globalThis.fetch, apiKey = ttsConfig().apiKey, now = Date.now, log = console } = {}) {
  if (!apiKey) return credits.value;
  const t = now();
  if (credits.at !== null && t - credits.at < CREDITS_TTL_MS) return credits.value;
  credits.at = t;
  try {
    const res = await fetch(`${API}/user/subscription`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(CREDITS_TIMEOUT_MS),
    });
    if (!res.ok) {
      logCreditsFailure(log, t, res.status);
      return credits.value;
    }
    const body = await res.json();
    if (!Number.isFinite(body.character_limit) || !Number.isFinite(body.character_count)) {
      logCreditsFailure(log, t, 'failed');
      return credits.value;
    }
    const left = body.character_limit - body.character_count;
    credits.value = left;
    return left;
  } catch {
    logCreditsFailure(log, t, 'failed');
    return credits.value;
  }
}

module.exports = { voiceSettings, synthesize, remainingCredits, resetCredits };
