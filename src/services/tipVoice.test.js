'use strict';

// The tip voice orchestrator with every outside piece stubbed: the database, ElevenLabs, the overlay's presence and
// a temporary folder for the audio files. Nothing here touches the network, the real database or data/.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t } = require('../i18n');
const { createTestCooldown } = require('./testCooldown');
const tipVoice = require('./tipVoice');
const { defaultVoice, modelFor } = require('./ttsVoices');

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const AUDIO = Buffer.from('ID3-fake-mp3-bytes');

let dir;
let nextStreamerId = 100;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tip-voice-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function makeStreamer(over = {}) {
  const id = nextStreamerId++;
  return {
    id,
    overlay_token: `tok-${id}`,
    tts_enabled: 1,
    tts_min_amount: 5,
    donation_currency: 'EUR',
    overlay_donation_enabled: 1,
    tts_language: 'en',
    tts_voice: null,
    tts_speed: 1,
    tts_expressiveness: 0.5,
    tts_volume: 0.6,
    tts_template: null,
    tts_template_empty: null,
    tts_monthly_limit: null,
    ...over,
  };
}

const donation = (over = {}) => ({ orderId: 'ORDER-1', donorName: 'Viewer', amount: 10, currency: 'EUR', message: 'Go go', ...over });

// Stubbed deps that record what was asked of them.
function makeDeps(over = {}) {
  const calls = { reserve: [], status: [], errors: [], cleared: [], synth: [], logged: [], bus: [] };
  let uuid = 0;
  const { db: dbOver, ...rest } = over;
  const deps = {
    db: {
      isOverlayEnabled: () => true,
      reserveTtsCharacters: (...args) => { calls.reserve.push(args); return true; },
      setDonationTtsStatus: (...args) => { calls.status.push(args); },
      recordTtsError: (...args) => { calls.errors.push(args); },
      clearTtsError: (...args) => { calls.cleared.push(args); },
      ...dbOver,
    },
    config: { tts: { apiKey: 'test-key', model: 'm', creditFloor: 20000, monthlyLimit: 15000 } },
    isOpen: () => true,
    bannedCheck: () => null,
    t,
    synthesize: async (args, opts) => { calls.synth.push({ args, opts }); return AUDIO; },
    remainingCredits: async () => 100000,
    bus: { emit: (...args) => { calls.bus.push(args); } },
    dir,
    now: () => NOW,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
    log: { error: (...args) => { calls.logged.push(args.join(' ')); } },
    ...rest,
  };
  return { deps, calls };
}

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('announceWithVoice', () => {
  test('a tip under the threshold fires the alert at once without a voice, status below_threshold, nothing synthesized', async () => {
    const { deps, calls } = makeDeps();
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation({ amount: 2 }), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: 'below_threshold' });
    assert.deepEqual(emitted, [null]);
    assert.equal(calls.synth.length, 0);
    assert.equal(calls.reserve.length, 0);
    assert.deepEqual(calls.status, [['paypal', 'ORDER-1', 'below_threshold']]);
  });

  test('TTS off: the alert as today, no status stored, nothing read', async () => {
    const { deps, calls } = makeDeps({ isOpen: () => { throw new Error('should not be asked'); } });
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer({ tts_enabled: 0 }), donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: null });
    assert.deepEqual(emitted, [null]);
    assert.equal(calls.status.length, 0);
    assert.equal(calls.synth.length, 0);
  });

  test('a read tip reserves the line, writes the file, then emits the alert with its url and volume', async () => {
    const { deps, calls } = makeDeps();
    const streamer = makeStreamer();
    const file = path.join(dir, String(streamer.id), `${UUID1}.mp3`);
    const emitted = [];
    const result = await tipVoice.announceWithVoice(streamer, donation(), {
      emitAlert: (tts) => {
        // The file is on disk before the overlay is told about it.
        assert.ok(fs.existsSync(file), 'the file exists when the alert is emitted');
        emitted.push(tts);
      },
      deps,
    });
    const line = 'Viewer tipped 10 euros: Go go';
    assert.deepEqual(result, { status: 'read' });
    assert.deepEqual(calls.reserve, [[streamer.id, '2026-10', line.length, 15000]]);
    assert.equal(calls.synth.length, 1);
    assert.deepEqual(calls.synth[0].args, { voiceId: defaultVoice('en'), text: line, speed: 1, expressiveness: 0.5, lang: 'en' });
    assert.ok(calls.synth[0].opts.timeoutMs <= tipVoice.AUDIO_DEADLINE_MS);
    assert.deepEqual(fs.readFileSync(file), AUDIO);
    assert.deepEqual(emitted, [{ url: `/overlay/tts/tok-${streamer.id}/${UUID1}.mp3`, volume: 0.6 }]);
    assert.deepEqual(calls.status, [['paypal', 'ORDER-1', 'read']]);
    assert.equal(calls.errors.length, 0);
  });

  test('Portuguese is spoken with Turbo v2.5 (it keeps a Portugal voice Portuguese); other languages use the configured model', async () => {
    const pt = makeDeps();
    await tipVoice.announceWithVoice(makeStreamer({ tts_language: 'pt' }), donation(), { emitAlert: () => {}, deps: pt.deps });
    assert.equal(pt.calls.synth[0].opts.model, 'eleven_turbo_v2_5');
    assert.equal(modelFor('pt', 'm'), 'eleven_turbo_v2_5');
    const en = makeDeps();
    await tipVoice.announceWithVoice(makeStreamer({ tts_language: 'en' }), donation(), { emitAlert: () => {}, deps: en.deps });
    assert.equal(en.calls.synth[0].opts.model, 'm');
    assert.equal(modelFor('en', 'm'), 'm');
  });

  test("the streamer's own monthly limit is used when an admin set one", async () => {
    const { deps, calls } = makeDeps();
    await tipVoice.announceWithVoice(makeStreamer({ tts_monthly_limit: 500 }), donation(), { emitAlert: () => {}, deps });
    assert.equal(calls.reserve[0][3], 500);
  });

  test("a message that hits the streamer's banned words is not read", async () => {
    const asked = [];
    const { deps, calls } = makeDeps({ bannedCheck: (text, id) => { asked.push(id); return text.includes('badword') ? { reason: 'x' } : null; } });
    const streamer = makeStreamer();
    await tipVoice.announceWithVoice(streamer, donation({ message: 'a badword here' }), { emitAlert: () => {}, deps });
    assert.equal(calls.synth[0].args.text, 'Viewer tipped 10 euros!');
    assert.ok(asked.length > 0 && asked.every((id) => id === streamer.id));
  });

  test('queue keeps tips in order', async () => {
    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const synth = [];
    const { deps } = makeDeps({
      synthesize: async (args) => { synth.push(args.text); return synth.length === 1 ? first : AUDIO; },
    });
    const streamer = makeStreamer();
    const emitted = [];
    const emitAlert = (tts) => emitted.push(tts && tts.url);
    const one = tipVoice.announceWithVoice(streamer, donation({ orderId: 'A', donorName: 'First' }), { emitAlert, deps });
    const two = tipVoice.announceWithVoice(streamer, donation({ orderId: 'B', donorName: 'Second' }), { emitAlert, deps });
    await settle();
    assert.equal(synth.length, 1, 'the second tip waits for the first');
    assert.deepEqual(emitted, []);
    release(AUDIO);
    assert.deepEqual(await Promise.all([one, two]), [{ status: 'read' }, { status: 'read' }]);
    assert.match(synth[0], /^First/);
    assert.match(synth[1], /^Second/);
    assert.deepEqual(emitted, [`/overlay/tts/tok-${streamer.id}/${UUID1}.mp3`, `/overlay/tts/tok-${streamer.id}/${UUID2}.mp3`]);
  });

  test("another streamer's tip does not wait", async () => {
    let n = 0;
    const { deps } = makeDeps({ synthesize: async () => (++n === 1 ? new Promise(() => {}) : AUDIO) });
    const emitted = [];
    tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: () => emitted.push('hung'), deps });
    await settle();
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: () => emitted.push('other'), deps });
    assert.deepEqual(result, { status: 'read' });
    assert.deepEqual(emitted, ['other']);
  });

  test('ElevenLabs hangs: after 15 s the alert comes without a voice, status failed, the characters stay counted', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let called;
    const synthCalled = new Promise((resolve) => { called = resolve; });
    const { deps, calls } = makeDeps({ synthesize: () => { called(); return new Promise(() => {}); } });
    const streamer = makeStreamer();
    const emitted = [];
    const pending = tipVoice.announceWithVoice(streamer, donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    await synthCalled;
    t.mock.timers.tick(tipVoice.AUDIO_DEADLINE_MS - 1);
    await settle();
    assert.deepEqual(emitted, [], 'nothing before the deadline');
    t.mock.timers.tick(1);
    assert.deepEqual(await pending, { status: 'failed' });
    assert.deepEqual(emitted, [null]);
    assert.equal(calls.reserve.length, 1, 'the line was reserved and nothing gives it back');
    assert.deepEqual(calls.status, [['paypal', 'ORDER-1', 'failed']]);
    assert.deepEqual(calls.errors, [[streamer.id, 'elevenlabs_timeout']]);
    assert.deepEqual(fs.readdirSync(dir), [], 'no file written');
  });

  test('an empty answer from ElevenLabs is a failure: no file, the alert without a voice', async () => {
    const { deps, calls } = makeDeps({ synthesize: async () => Buffer.alloc(0) });
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: 'failed' });
    assert.deepEqual(emitted, [null]);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(calls.errors.length, 1);
  });

  test('a refusal from ElevenLabs: status failed, the error recorded, logged at most once per streamer per hour', async () => {
    let now = NOW;
    const { deps, calls } = makeDeps({ synthesize: async () => { throw new Error('elevenlabs_401'); }, now: () => now });
    const streamer = makeStreamer();
    const emitted = [];
    const emitAlert = (tts) => emitted.push(tts);
    assert.deepEqual(await tipVoice.announceWithVoice(streamer, donation(), { emitAlert, deps }), { status: 'failed' });
    now += 30 * 60 * 1000;
    await tipVoice.announceWithVoice(streamer, donation(), { emitAlert, deps });
    assert.deepEqual(emitted, [null, null]);
    assert.deepEqual(calls.errors.map((args) => args[1]), ['elevenlabs_401', 'elevenlabs_401'], 'the last error is always stored');
    assert.equal(calls.logged.length, 1, 'logged once in the hour');
    assert.match(calls.logged[0], /elevenlabs_401/);
    now += 31 * 60 * 1000;
    await tipVoice.announceWithVoice(streamer, donation(), { emitAlert, deps });
    assert.equal(calls.logged.length, 2, 'logged again after an hour');
  });

  test('over the monthly limit: alert without a voice, status limit, synthesize never called', async () => {
    const reserved = [];
    const { deps, calls } = makeDeps({ db: { reserveTtsCharacters: (...args) => { reserved.push(args); return false; } } });
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: 'limit' });
    assert.deepEqual(emitted, [null]);
    assert.equal(reserved.length, 1);
    assert.equal(calls.synth.length, 0);
    assert.deepEqual(calls.status, [['paypal', 'ORDER-1', 'limit']]);
  });

  test("below the site floor: its own status credit_floor (not the streamer's limit), nothing reserved", async () => {
    const { deps, calls } = makeDeps({ remainingCredits: async () => 19999 });
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: 'credit_floor' });
    assert.deepEqual(emitted, [null]);
    assert.equal(calls.reserve.length, 0);
    assert.equal(calls.synth.length, 0);
    assert.deepEqual(calls.status, [['paypal', 'ORDER-1', 'credit_floor']]);
    assert.equal(calls.errors.length, 1, 'the stop is recorded for the settings page');
    assert.equal(calls.errors[0][1], 'credit_floor');
  });

  test('a streamer whose volume is 0 is not read: nothing reserved or sent, the alert at once, no status', async () => {
    const { deps, calls } = makeDeps();
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer({ tts_volume: 0 }), donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: null });
    assert.deepEqual(emitted, [null]);
    assert.equal(calls.reserve.length, 0);
    assert.equal(calls.synth.length, 0);
    assert.equal(calls.status.length, 0);
    assert.equal(calls.errors.length, 0);
    // a volume that is not stored yet is the default, not silence
    const unset = await tipVoice.announceWithVoice(makeStreamer({ tts_volume: null }), donation(), { emitAlert: () => {}, deps });
    assert.deepEqual(unset, { status: 'read' });
  });

  test('a good reading clears the last problem; a failed one does not', async () => {
    const { deps, calls } = makeDeps();
    const streamer = makeStreamer();
    await tipVoice.announceWithVoice(streamer, donation(), { emitAlert: () => {}, deps });
    assert.deepEqual(calls.cleared, [[streamer.id]]);

    const failing = makeDeps({ synthesize: async () => { throw new Error('elevenlabs_500'); } });
    await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: () => {}, deps: failing.deps });
    assert.equal(failing.calls.cleared.length, 0);

    const broken = makeDeps({ db: { clearTtsError: () => { throw new Error('db down'); } } });
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: () => {}, deps: broken.deps });
    assert.deepEqual(result, { status: 'read' }, 'a problem clearing it changes nothing');
  });

  test('credits not known yet (no good read so far) do not stop reading', async () => {
    const { deps } = makeDeps({ remainingCredits: async () => null });
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: () => {}, deps });
    assert.deepEqual(result, { status: 'read' });
  });

  test('without an API key nothing is reserved or sent: status failed', async () => {
    const { deps, calls } = makeDeps();
    deps.config = { tts: { ...deps.config.tts, apiKey: null } };
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation(), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: 'failed' });
    assert.deepEqual(emitted, [null]);
    assert.equal(calls.reserve.length, 0);
    assert.equal(calls.synth.length, 0);
  });

  test('a database error still fires the alert, and the next tip of the streamer is not held up', async () => {
    let broken = true;
    const { deps } = makeDeps({ db: { isOverlayEnabled: () => { if (broken) throw new Error('db down'); return true; } } });
    const streamer = makeStreamer();
    const emitted = [];
    const emitAlert = (tts) => emitted.push(tts && 'voice');
    assert.deepEqual(await tipVoice.announceWithVoice(streamer, donation(), { emitAlert, deps }), { status: 'failed' });
    broken = false;
    assert.deepEqual(await tipVoice.announceWithVoice(streamer, donation(), { emitAlert, deps }), { status: 'read' });
    assert.deepEqual(emitted, [null, 'voice']);
  });

  test('an alert that throws while being emitted does not break the queue', async () => {
    const { deps } = makeDeps();
    const streamer = makeStreamer();
    const result = await tipVoice.announceWithVoice(streamer, donation({ amount: 1 }), { emitAlert: () => { throw new Error('bus'); }, deps });
    assert.deepEqual(result, { status: 'below_threshold' });
    const emitted = [];
    await tipVoice.announceWithVoice(streamer, donation({ amount: 1 }), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(emitted, [null]);
  });

  test('a status that cannot be stored does not stop the alert', async () => {
    const { deps } = makeDeps({ db: { setDonationTtsStatus: () => { throw new Error('db down'); } } });
    const emitted = [];
    const result = await tipVoice.announceWithVoice(makeStreamer(), donation({ amount: 1 }), { emitAlert: (tts) => emitted.push(tts), deps });
    assert.deepEqual(result, { status: 'below_threshold' });
    assert.deepEqual(emitted, [null]);
  });
});

describe('testVoice', () => {
  test('reads the sample at the threshold amount, counts it, and plays it in OBS when the overlay is open', async () => {
    const { deps, calls } = makeDeps({ cooldown: createTestCooldown({ cooldownMs: 10000 }) });
    const streamer = makeStreamer({ tts_min_amount: 3, tts_enabled: 0 });
    const result = await tipVoice.testVoice(streamer, deps);
    assert.deepEqual(result, { ok: true, file: `${UUID1}.mp3` });
    const name = t('en', 'tts.sample.name');
    const message = t('en', 'tts.sample.message');
    const line = `${name} tipped 3 euros: ${message}`;
    assert.equal(calls.synth[0].args.text, line);
    assert.deepEqual(calls.reserve, [[streamer.id, '2026-10', line.length, 15000]]);
    assert.ok(fs.existsSync(path.join(dir, String(streamer.id), `${UUID1}.mp3`)));
    assert.deepEqual(calls.bus, [[`overlay:${streamer.id}`, {
      type: 'donation',
      data: { username: name, amount: 3, message, currency: 'EUR', tts: { url: `/overlay/tts/tok-${streamer.id}/${UUID1}.mp3`, volume: 0.6 } },
    }]]);
    assert.equal(calls.status.length, 0, 'a test is no donation');
  });

  test('with the overlay closed it is only played in the page', async () => {
    const { deps, calls } = makeDeps({ isOpen: () => false, cooldown: createTestCooldown({ cooldownMs: 10000 }) });
    const result = await tipVoice.testVoice(makeStreamer(), deps);
    assert.equal(result.ok, true);
    assert.equal(calls.bus.length, 0);
  });

  test('the test answers cooldown within 10 s', async () => {
    let clock = 0;
    const { deps, calls } = makeDeps({ cooldown: createTestCooldown({ now: () => clock, cooldownMs: 10000 }) });
    const streamer = makeStreamer();
    assert.equal((await tipVoice.testVoice(streamer, deps)).ok, true);
    clock = 9999;
    assert.deepEqual(await tipVoice.testVoice(streamer, deps), { ok: false, error: 'cooldown' });
    assert.equal(calls.synth.length, 1);
    clock = 10000;
    assert.equal((await tipVoice.testVoice(streamer, deps)).ok, true);
  });

  test("the module's own cooldown is 10 s per streamer", async () => {
    const { deps } = makeDeps();
    const streamer = makeStreamer();
    assert.equal(tipVoice.TEST_COOLDOWN_MS, 10000);
    assert.equal((await tipVoice.testVoice(streamer, deps)).ok, true);
    assert.deepEqual(await tipVoice.testVoice(streamer, deps), { ok: false, error: 'cooldown' });
    assert.equal((await tipVoice.testVoice(makeStreamer(), deps)).ok, true, 'another streamer is not held');
  });

  test('limit, failure and no key each answer their code', async () => {
    const cooldown = () => createTestCooldown({ cooldownMs: 10000 });
    let { deps } = makeDeps({ cooldown: cooldown(), db: { reserveTtsCharacters: () => false } });
    assert.deepEqual(await tipVoice.testVoice(makeStreamer(), deps), { ok: false, error: 'limit' });
    ({ deps } = makeDeps({ cooldown: cooldown(), remainingCredits: async () => 10 }));
    assert.deepEqual(await tipVoice.testVoice(makeStreamer(), deps), { ok: false, error: 'credit_floor' }, "the site floor is not the streamer's limit");
    ({ deps } = makeDeps({ cooldown: cooldown(), synthesize: async () => { throw new Error('elevenlabs_failed'); } }));
    assert.deepEqual(await tipVoice.testVoice(makeStreamer(), deps), { ok: false, error: 'failed' });
    ({ deps } = makeDeps({ cooldown: cooldown() }));
    deps.config = { tts: { ...deps.config.tts, apiKey: null } };
    assert.deepEqual(await tipVoice.testVoice(makeStreamer(), deps), { ok: false, error: 'unavailable' });
  });
});

describe('testVoice clears the last problem', () => {
  test('after a good reading', async () => {
    const { deps, calls } = makeDeps({ cooldown: createTestCooldown({ cooldownMs: 10000 }) });
    const streamer = makeStreamer();
    assert.equal((await tipVoice.testVoice(streamer, deps)).ok, true);
    assert.deepEqual(calls.cleared, [[streamer.id]]);
  });
});

describe('cleanupTtsFiles', () => {
  const age = (file, ms) => { const at = new Date(NOW - ms); fs.utimesSync(file, at, at); };

  test('the cleanup removes files older than an hour and keeps newer ones', () => {
    const folder = path.join(dir, '7');
    fs.mkdirSync(folder);
    const old = path.join(folder, `${UUID1}.mp3`);
    const fresh = path.join(folder, `${UUID2}.mp3`);
    fs.writeFileSync(old, AUDIO);
    fs.writeFileSync(fresh, AUDIO);
    age(old, tipVoice.FILE_MAX_AGE_MS + 1000);
    age(fresh, 60 * 1000);
    const emptied = path.join(dir, '8');
    fs.mkdirSync(emptied);
    const gone = path.join(emptied, `${UUID1}.mp3`);
    fs.writeFileSync(gone, AUDIO);
    age(gone, 2 * tipVoice.FILE_MAX_AGE_MS);

    assert.equal(tipVoice.cleanupTtsFiles({ now: NOW, dir }), 2);
    assert.deepEqual(fs.readdirSync(folder), [`${UUID2}.mp3`]);
    assert.equal(fs.existsSync(emptied), false, 'an emptied folder is removed');
  });

  test('a folder that cannot be read does not stop the sweep of the others', () => {
    const bad = path.join(dir, '1');
    const good = path.join(dir, '2');
    fs.mkdirSync(bad);
    fs.mkdirSync(good);
    const old = path.join(good, `${UUID1}.mp3`);
    fs.writeFileSync(old, AUDIO);
    age(old, 2 * tipVoice.FILE_MAX_AGE_MS);
    const real = fs.readdirSync;
    fs.readdirSync = (target, ...rest) => {
      if (target === bad) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return real(target, ...rest);
    };
    try {
      assert.equal(tipVoice.cleanupTtsFiles({ now: NOW, dir }), 1);
    } finally {
      fs.readdirSync = real;
    }
    assert.equal(fs.existsSync(good), false, 'the readable folder was swept and removed');
    assert.equal(fs.existsSync(bad), true);
  });

  test('no folder yet: nothing to do', () => {
    assert.equal(tipVoice.cleanupTtsFiles({ now: NOW, dir: path.join(dir, 'missing') }), 0);
  });
});

describe('ttsFilePath', () => {
  test("only a uuid .mp3 name, inside the streamer's folder", () => {
    assert.equal(tipVoice.ttsFilePath(7, `${UUID1}.mp3`, dir), path.join(dir, '7', `${UUID1}.mp3`));
    const lettered = '3f2a9c1e-7b4d-4e8f-9a0b-1c2d3e4f5a6b';
    assert.equal(tipVoice.ttsFilePath(7, `${lettered}.mp3`, dir), path.join(dir, '7', `${lettered}.mp3`));
    for (const bad of ['../x.mp3', `${UUID1}.wav`, `${UUID1}.mp3/`, '..', `../${UUID1}.mp3`, `${lettered.toUpperCase()}.mp3`, '', undefined]) {
      assert.equal(tipVoice.ttsFilePath(7, bad, dir), null, String(bad));
    }
  });
});
