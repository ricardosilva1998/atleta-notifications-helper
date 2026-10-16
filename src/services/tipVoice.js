'use strict';

// Tips read aloud: the donation alert waits for its voice. For each new PayPal tip announceWithVoice() decides whether
// it is read (tipSpeech.speechDecision), stops below the account's credit floor, reserves the line's characters in the
// streamer's month, asks ElevenLabs for the audio under one 15-second deadline, stores the MP3 at
// data/tts/<streamerId>/<uuid>.mp3 and only then emits the alert, with `tts: { url, volume }` when there is a voice
// and without it otherwise. One tip at a time per streamer, so a burst is read in order. testVoice() reads a sample tip
// for the settings page; cleanupTtsFiles() removes files older than an hour (src/index.js runs it hourly).
//
// Everything outside this file (the database, ElevenLabs, the overlay's presence, the banned words, the folder, the
// clock) comes through `deps`, so the tests stub it; the defaults are required only when first used, so loading this
// file (src/routes/tip.js does) needs no configuration.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { speechDecision, prepareSpeech } = require('./tipSpeech');
const { defaultVoice, isVoice, modelFor } = require('./ttsVoices');
const { createTestCooldown } = require('./testCooldown');

const TTS_DIR = path.join(__dirname, '..', '..', 'data', 'tts');
const FILE_MAX_AGE_MS = 60 * 60 * 1000;
const AUDIO_DEADLINE_MS = 15000;
const TEST_COOLDOWN_MS = 10000;
const ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // a streamer's failures are logged at most once an hour
const SWEEP_INTERVAL_MS = 60 * 1000;

const FILE_NAME = /^[0-9a-f-]{36}\.mp3$/;
// The errors stored as they are for the settings page; anything else (a database or disk error) is stored as 'failed'.
const ERROR_CODES = /^(no_key|credit_floor|elevenlabs_[a-z0-9_]+)$/;

const VOLUME_DEFAULT = 0.8;
const SPEED_DEFAULT = 1;
const EXPRESSIVENESS_DEFAULT = 0.5;

const testCooldown = createTestCooldown({ cooldownMs: TEST_COOLDOWN_MS });
const chains = new Map(); // streamerId -> the promise of its last tip; removed once that tip is done
const lastLogged = new Map(); // streamerId -> when its last failure was logged

const DEFAULTS = {
  get db() { return require('../db'); },
  get config() { return require('../config'); },
  get t() { return require('../i18n').t; },
  get bus() { return require('./overlayBus'); },
  isOpen: (streamerId) => require('./overlayPresence').isOpen(streamerId),
  bannedCheck: (text, streamerId) => require('./chatModeration').checkBannedWords(text, streamerId),
  synthesize: (request, options) => require('./elevenLabs').synthesize(request, options),
  remainingCredits: () => require('./elevenLabs').remainingCredits(),
  cooldown: testCooldown,
  dir: TTS_DIR,
  now: () => Date.now(),
  randomUUID: () => crypto.randomUUID(),
  log: console,
};

// The defaults with the given deps on top (own properties, so a getter above is never asked for what a test gave).
function using(deps = {}) {
  const d = Object.create(DEFAULTS);
  for (const [key, value] of Object.entries(deps)) Object.defineProperty(d, key, { value, enumerable: true });
  return d;
}

setInterval(() => {
  testCooldown.sweep();
  const now = Date.now();
  for (const [streamerId, at] of lastLogged) if (now - at >= ERROR_LOG_INTERVAL_MS) lastLogged.delete(streamerId);
}, SWEEP_INTERVAL_MS).unref();

// The path of one of a streamer's audio files, or null for a name that is not one this file makes.
function ttsFilePath(streamerId, name, root = TTS_DIR) {
  if (typeof name !== 'string' || !FILE_NAME.test(name)) return null;
  return path.join(root, String(streamerId), name);
}

const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7); // UTC 'YYYY-MM'

// Stores the error for the settings page every time; logs it at most once per streamer per hour.
function noteError(d, streamerId, err) {
  const message = String((err && err.message) || err);
  try { d.db.recordTtsError(streamerId, ERROR_CODES.test(message) ? message : 'failed'); } catch { /* the database is down: nothing more to do */ }
  const now = d.now();
  const last = lastLogged.get(streamerId);
  if (last !== undefined && now - last < ERROR_LOG_INTERVAL_MS) return;
  lastLogged.set(streamerId, now);
  d.log.error(`[TTS] Streamer ${streamerId}: ${message}`);
}

// The voice for one line, under one deadline that covers the credits read, the reservation, the request and the file.
// Resolves { status: 'credit_floor' } (the site's budget), { status: 'limit' } (the streamer's month) or
// { status: 'read', file, tts }; rejects on any failure (the deadline included). Once
// the deadline has passed nothing more is reserved or written; characters already reserved stay counted.
function voiceFor(streamer, text, d) {
  const started = d.now();
  let timer;
  let over = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { over = true; reject(new Error('elevenlabs_timeout')); }, AUDIO_DEADLINE_MS);
  });

  const produce = async () => {
    const { tts: settings } = d.config;
    if (!settings.apiKey) throw new Error('no_key');
    // Credits not known yet (no good read so far) do not stop reading: only a known balance below the floor does.
    const credits = await d.remainingCredits();
    if (credits != null && credits < settings.creditFloor) {
      noteError(d, streamer.id, new Error('credit_floor'));
      return { status: 'credit_floor' };
    }
    if (over) throw new Error('elevenlabs_timeout');
    const limit = streamer.tts_monthly_limit ?? settings.monthlyLimit;
    if (!d.db.reserveTtsCharacters(streamer.id, monthOf(d.now()), text.length, limit)) return { status: 'limit' };

    const lang = streamer.tts_language || 'en';
    const audio = await d.synthesize({
      voiceId: isVoice(lang, streamer.tts_voice) ? streamer.tts_voice : defaultVoice(lang),
      text,
      speed: streamer.tts_speed ?? SPEED_DEFAULT,
      expressiveness: streamer.tts_expressiveness ?? EXPRESSIVENESS_DEFAULT,
      lang,
    }, { model: modelFor(lang, settings.model), timeoutMs: Math.max(1, AUDIO_DEADLINE_MS - (d.now() - started)) });
    if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error('elevenlabs_empty');
    if (over) throw new Error('elevenlabs_timeout');

    const file = `${d.randomUUID()}.mp3`;
    const folder = path.join(d.dir, String(streamer.id));
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(path.join(folder, file), audio);
    return {
      status: 'read',
      file,
      tts: { url: `/overlay/tts/${encodeURIComponent(streamer.overlay_token)}/${file}`, volume: streamer.tts_volume ?? VOLUME_DEFAULT },
    };
  };

  return Promise.race([produce(), deadline]).finally(() => clearTimeout(timer));
}

// A good reading ends the last problem the settings page shows.
function clearError(d, streamerId) {
  try { d.db.clearTtsError(streamerId); } catch { /* the database is down: the old problem stays shown */ }
}

// One tip: decide, read, emit, store the status. Never rejects, and emits exactly once.
async function voiceThenAlert(streamer, donation, emitAlert, d) {
  let status = null;
  let tts = null;
  if (streamer.tts_enabled) {
    try {
      const decision = speechDecision({
        streamer,
        donation,
        overlayOn: d.db.isOverlayEnabled(streamer.id),
        alertOn: Boolean(streamer.overlay_donation_enabled),
        overlayOpen: d.isOpen(streamer.id),
      });
      status = decision.status;
      // A voice at volume 0 is silent: nothing is asked of ElevenLabs or reserved, and the alert is not held up.
      if (decision.read && streamer.tts_volume != null && Number(streamer.tts_volume) === 0) {
        // no voice, no status
      } else if (decision.read) {
        const { text } = prepareSpeech({ streamer, donation, t: d.t, bannedCheck: (value) => d.bannedCheck(value, streamer.id) });
        const voice = await voiceFor(streamer, text, d);
        status = voice.status;
        tts = voice.tts || null;
        if (status === 'read') clearError(d, streamer.id);
      }
    } catch (err) {
      status = 'failed';
      tts = null;
      noteError(d, streamer.id, err);
    }
  }

  try { emitAlert(tts); } catch (err) { d.log.error(`[TTS] Donation alert error for streamer ${streamer.id}: ${err.message}`); }
  if (status !== null) {
    try { d.db.setDonationTtsStatus('paypal', donation.orderId, status); } catch (err) { d.log.error(`[TTS] Status not stored: ${err.message}`); }
  }
  return { status };
}

// The donation alert of a new PayPal tip, with its voice when it is read. Tips of one streamer are handled one at a
// time, in order; each link catches its own errors, so the chain never holds a rejection, and it is forgotten once done.
function announceWithVoice(streamer, donation, { emitAlert, deps } = {}) {
  const d = using(deps);
  const previous = chains.get(streamer.id) || Promise.resolve();
  const current = previous.then(() => voiceThenAlert(streamer, donation, emitAlert, d));
  chains.set(streamer.id, current);
  current.then(() => { if (chains.get(streamer.id) === current) chains.delete(streamer.id); });
  return current;
}

// "Test the voice": a sample tip at the threshold amount, built and cleaned like a real one, with the streamer's
// settings (the TTS switch need not be on). It counts toward the month and has its own 10-second cooldown. When the
// overlay is open it plays there too, as a donation alert. `file` is the audio's name in the streamer's folder.
async function testVoice(streamer, deps) {
  const d = using(deps);
  if (!d.config.tts.apiKey) return { ok: false, error: 'unavailable' };
  if (d.cooldown.take(streamer.id) > 0) return { ok: false, error: 'cooldown' };

  const lang = streamer.tts_language || 'en';
  const sample = {
    donorName: d.t(lang, 'tts.sample.name'),
    amount: streamer.tts_min_amount,
    currency: streamer.donation_currency,
    message: d.t(lang, 'tts.sample.message'),
  };
  try {
    const { text } = prepareSpeech({ streamer, donation: sample, t: d.t, bannedCheck: (value) => d.bannedCheck(value, streamer.id) });
    const voice = await voiceFor(streamer, text, d);
    if (voice.status === 'credit_floor') return { ok: false, error: 'credit_floor' };
    if (voice.status === 'limit') return { ok: false, error: 'limit' };
    clearError(d, streamer.id);
    if (d.isOpen(streamer.id)) {
      d.bus.emit(`overlay:${streamer.id}`, {
        type: 'donation',
        data: { username: sample.donorName, amount: sample.amount, message: sample.message, currency: sample.currency, tts: voice.tts },
      });
    }
    return { ok: true, file: voice.file };
  } catch (err) {
    noteError(d, streamer.id, err);
    return { ok: false, error: 'failed' };
  }
}

// Removes the audio files older than maxAgeMs (by their time on disk) and the folders left empty; returns how many
// files went. A missing folder is nothing to do.
function cleanupTtsFiles({ now = Date.now(), maxAgeMs = FILE_MAX_AGE_MS, dir = TTS_DIR } = {}) {
  let removed = 0;
  let folders;
  try { folders = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    // One folder that is unreadable or vanished meanwhile does not stop the sweep of the others.
    try {
      const folderPath = path.join(dir, folder.name);
      let left = 0;
      for (const name of fs.readdirSync(folderPath)) {
        const file = path.join(folderPath, name);
        try {
          if (now - fs.statSync(file).mtimeMs > maxAgeMs) {
            fs.unlinkSync(file);
            removed++;
          } else {
            left++;
          }
        } catch {
          left++;
        }
      }
      if (left === 0) {
        try { fs.rmdirSync(folderPath); } catch { /* a file arrived meanwhile */ }
      }
    } catch { /* this folder is skipped */ }
  }
  return removed;
}

module.exports = {
  TTS_DIR,
  FILE_MAX_AGE_MS,
  AUDIO_DEADLINE_MS,
  TEST_COOLDOWN_MS,
  announceWithVoice,
  testVoice,
  cleanupTtsFiles,
  ttsFilePath,
};
