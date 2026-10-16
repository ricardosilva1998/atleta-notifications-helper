'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceSettings, synthesize, remainingCredits, resetCredits } = require('./elevenLabs');

const quiet = { error() {} };

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

  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), 87655);
  assert.equal(calls[0][0], 'https://api.elevenlabs.io/v1/user/subscription');
  assert.equal(calls[0][1].headers['xi-api-key'], 'k');
  assert.ok(calls[0][1].signal);

  t += 9 * 60 * 1000;
  answer = { ok: true, status: 200, json: async () => ({ character_limit: 100000, character_count: 50000 }) };
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), 87655);
  assert.equal(calls.length, 1);

  t += 2 * 60 * 1000;
  answer = { ok: false, status: 500, json: async () => ({}) };
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), 87655);
  assert.equal(calls.length, 2);

  t += 11 * 60 * 1000;
  answer = new Error('offline');
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), 87655);
  assert.equal(calls.length, 3);

  t += 11 * 60 * 1000;
  answer = { ok: true, status: 200, json: async () => ({ character_limit: 100000, character_count: 50000 }) };
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), 50000);
});

test('remaining credits are null when nothing was ever read, and without a key nothing is asked', async () => {
  resetCredits();
  const fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now: () => 1, log: quiet }), null);
  let called = false;
  resetCredits();
  assert.equal(await remainingCredits({ fetch: async () => { called = true; return fetch(); }, apiKey: null, now: () => 1 }), null);
  assert.equal(called, false);
});

test('an unreadable subscription answer is a failed read', async () => {
  resetCredits();
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ character_limit: 'x' }) });
  assert.equal(await remainingCredits({ fetch, apiKey: 'k', now: () => 1, log: quiet }), null);
});

test('after a failed read nothing is asked again for 10 minutes, whether or not a value is known', async () => {
  for (const known of [false, true]) {
    resetCredits();
    let t = 5_000_000;
    const now = () => t;
    let calls = 0;
    let answer = { ok: true, status: 200, json: async () => ({ character_limit: 10, character_count: 4 }) };
    const fetch = async () => { calls++; if (answer instanceof Error) throw answer; return answer; };
    if (known) {
      assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), 6);
      t += 11 * 60 * 1000;
    }
    calls = 0;
    answer = known ? new Error('offline') : { ok: false, status: 401, json: async () => ({}) };
    const last = known ? 6 : null;
    assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), last);
    assert.equal(calls, 1);
    t += 60 * 1000;
    assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), last);
    assert.equal(calls, 1);
    t += 10 * 60 * 1000;
    assert.equal(await remainingCredits({ fetch, apiKey: 'k', now, log: quiet }), last);
    assert.equal(calls, 2);
  }
});

test('a failed credits read is logged as "[TTS] Credits read failed: <status|failed>", at most once an hour, never with the key', async () => {
  resetCredits();
  let t = 9_000_000;
  const now = () => t;
  const logged = [];
  const log = { error: (...args) => logged.push(args.join(' ')) };
  let answer = { ok: false, status: 401, json: async () => ({}) };
  const fetch = async () => { if (answer instanceof Error) throw answer; return answer; };
  const read = () => remainingCredits({ fetch, apiKey: 'secret-key', now, log });

  assert.equal(await read(), null);
  assert.deepEqual(logged, ['[TTS] Credits read failed: 401']);

  for (let i = 0; i < 4; i++) { t += 11 * 60 * 1000; await read(); } // 44 more minutes: still the same hour
  assert.equal(logged.length, 1, 'not again within the hour');

  t += 17 * 60 * 1000; // 61 min since the first log
  answer = new Error('socket hang up with secret-key');
  await read();
  assert.equal(logged.length, 2, 'logged again after an hour');
  assert.equal(logged[1], '[TTS] Credits read failed: failed', 'a network failure or timeout reads "failed"');

  t += 61 * 60 * 1000;
  answer = { ok: true, status: 200, json: async () => ({ character_limit: 'x' }) };
  await read();
  assert.equal(logged[2], '[TTS] Credits read failed: failed', 'an unreadable answer reads "failed" too');
  assert.ok(logged.every((line) => !/secret-key/.test(line)), 'the key is never logged');

  t += 11 * 60 * 1000;
  answer = { ok: true, status: 200, json: async () => ({ character_limit: 10, character_count: 4 }) };
  assert.equal(await read(), 6);
  assert.equal(logged.length, 3, 'a good read logs nothing');
});
