'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceSettings, synthesize, remainingCredits, resetCredits } = require('./elevenLabs');

function okAudio(bytes = [1, 2]) {
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes).buffer };
}

test('voice settings follow the expressiveness: steadier when low, livelier when high', () => {
  assert.deepEqual(voiceSettings(1, 0), { stability: 0.85, similarity_boost: 0.75, style: 0, speed: 1, use_speaker_boost: true });
  assert.deepEqual(voiceSettings(0.9, 1), { stability: 0.25, similarity_boost: 0.75, style: 0.6, speed: 0.9, use_speaker_boost: true });
  assert.equal(voiceSettings(1, 0.333).stability, 0.65);
  assert.equal(voiceSettings(1, 0.333).style, 0.2);
});

test('asks for an MP3 with the voice, model, language and settings', async () => {
  const calls = [];
  const fetch = async (u, o) => { calls.push([u, o]); return okAudio(); };
  const buf = await synthesize({ voiceId: 'V1', text: 'Hi', speed: 1.1, expressiveness: 0.5, lang: 'en' }, { fetch, apiKey: 'k', model: 'eleven_multilingual_v2' });
  assert.equal(calls[0][0], 'https://api.elevenlabs.io/v1/text-to-speech/V1?output_format=mp3_44100_128');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['xi-api-key'], 'k');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.equal(calls[0][1].headers.Accept, 'audio/mpeg');
  assert.deepEqual(JSON.parse(calls[0][1].body), { text: 'Hi', model_id: 'eleven_multilingual_v2', language_code: 'en', voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.3, speed: 1.1, use_speaker_boost: true } });
  assert.ok(calls[0][1].signal);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.length, 2);
});

test('a voice id is escaped in the path', async () => {
  const calls = [];
  const fetch = async (u) => { calls.push(u); return okAudio(); };
  await synthesize({ voiceId: 'a/b?c', text: 'Hi', speed: 1, expressiveness: 0, lang: 'en' }, { fetch, apiKey: 'k', model: 'm' });
  assert.equal(calls[0], 'https://api.elevenlabs.io/v1/text-to-speech/a%2Fb%3Fc?output_format=mp3_44100_128');
});

test('a refusal throws elevenlabs_<status>; no key throws no_key', async () => {
  const fetch = async () => ({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0) });
  const args = { voiceId: 'V1', text: 'Hi', speed: 1, expressiveness: 0, lang: 'en' };
  await assert.rejects(synthesize(args, { fetch, apiKey: 'secret-key', model: 'm' }), (e) => e.message === 'elevenlabs_401');
  let called = false;
  await assert.rejects(synthesize(args, { fetch: async () => { called = true; return okAudio(); }, apiKey: null, model: 'm' }), (e) => e.message === 'no_key');
  assert.equal(called, false);
});

test('a network failure never carries the key in its message', async () => {
  const fetch = async () => { throw new Error('socket hang up'); };
  await assert.rejects(
    synthesize({ voiceId: 'V1', text: 'Hi', speed: 1, expressiveness: 0, lang: 'en' }, { fetch, apiKey: 'secret-key', model: 'm' }),
    (e) => e.message === 'elevenlabs_failed' && !/secret-key/.test(String(e.stack)),
  );
});

test('remaining credits are read at most every 10 minutes and a failed read keeps the last value', async () => {
  resetCredits();
  let t = 1_000_000;
  const now = () => t;
  const calls = [];
  let answer = { ok: true, status: 200, json: async () => ({ character_limit: 100000, character_count: 12345 }) };
  const fetch = async (u, o) => { calls.push([u, o]); if (answer instanceof Error) throw answer; return answer; };

  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now }), 87655);
  assert.equal(calls[0][0], 'https://api.elevenlabs.io/v1/user/subscription');
  assert.equal(calls[0][1].headers['xi-api-key'], 'k');
  assert.ok(calls[0][1].signal);

  t += 9 * 60 * 1000;
  answer = { ok: true, status: 200, json: async () => ({ character_limit: 100000, character_count: 50000 }) };
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now }), 87655);
  assert.equal(calls.length, 1);

  t += 2 * 60 * 1000;
  answer = { ok: false, status: 500, json: async () => ({}) };
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now }), 87655);
  assert.equal(calls.length, 2);

  answer = new Error('offline');
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now }), 87655);

  answer = { ok: true, status: 200, json: async () => ({ character_limit: 100000, character_count: 50000 }) };
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now }), 50000);
});

test('remaining credits are null when nothing was ever read, and without a key nothing is asked', async () => {
  resetCredits();
  const fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now: () => 1 }), null);
  let called = false;
  resetCredits();
  assert.equal(await remainingCredits({ fetch: async () => { called = true; return fetch(); }, apiKey: null, now: () => 1 }), null);
  assert.equal(called, false);
});

test('an unreadable subscription answer is a failed read', async () => {
  resetCredits();
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ character_limit: 'x' }) });
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now: () => 1 }), null);
});
