'use strict';

// The alert looks' recorded sounds (docs/features/look-sounds.md): the files in
// public/overlay/objects/sounds/, the table scripts/look-sounds.js writes from them, the joined script
// that serves it, and the kit that plays a recording (or, when it cannot, the synthesized sound).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { scan, render } = require('../scripts/look-sounds');
const { bundle } = require('../src/services/alertStyleBundle');
const styles = require('../src/services/alertStyles');

const OBJECTS_DIR = path.join(__dirname, '..', 'public', 'overlay', 'objects');
const SOUNDS_DIR = path.join(OBJECTS_DIR, 'sounds');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

describe('the recordings and their table', () => {
  test('sounds/manifest.js is what scripts/look-sounds.js writes from the files', () => {
    assert.equal(fs.readFileSync(path.join(SOUNDS_DIR, 'manifest.js'), 'utf8'), render(scan()));
  });

  test('every look\'s own sound has a default recording and a second version, each an MP3 of at most 200 kB', () => {
    const table = scan();
    for (const id of styles.lookIds()) {
      const key = styles.lookOf(id).sound;
      assert.ok(table[key] && table[key][0] && table[key][1], `${id}: ${key} has both recordings`);
    }
    for (const [key, files] of Object.entries(table)) {
      assert.ok(styles.soundKeys().includes(key), `${key} is a sound a look registers`);
      for (const file of files) {
        const bytes = fs.readFileSync(path.join(SOUNDS_DIR, file));
        assert.ok(bytes.length <= 200 * 1024, `${file}: ${bytes.length} bytes`);
        const id3 = bytes.subarray(0, 3).toString('latin1') === 'ID3';
        assert.ok(id3 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), `${file} starts like an MP3`);
      }
    }
  });

  test('a recording is named after its key and its hash; a name, content or pair that is off is refused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-sounds-'));
    try {
      fs.mkdirSync(path.join(dir, 'kittest'));
      const bytes = Buffer.from('ID3 a recording');
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
      const write = (name) => fs.writeFileSync(path.join(dir, 'kittest', name), bytes);
      write(`kitBeep.${hash}.mp3`);
      write(`kitBeep.2.${hash}.mp3`);
      assert.deepEqual(scan(dir), { kitBeep: [`kittest/kitBeep.${hash}.mp3`, `kittest/kitBeep.2.${hash}.mp3`] });
      write(`kitBell.2.${hash}.mp3`);
      assert.throws(() => scan(dir), /kitBell: a second version without a default recording/);
      fs.rmSync(path.join(dir, 'kittest', `kitBell.2.${hash}.mp3`));
      write('kitBell.0000000000.mp3');
      assert.throws(() => scan(dir), /hashes to/);
      fs.rmSync(path.join(dir, 'kittest', 'kitBell.0000000000.mp3'));
      write('kit bell.mp3');
      assert.throws(() => scan(dir), /is named <key>\.<hash>\.mp3/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the joined script registers the recordings after every family', () => {
    const { js } = bundle();
    const at = js.indexOf('// ── sounds/manifest.js ──');
    assert.ok(at > 0 && at > js.lastIndexOf('// ── styles/'), 'the table comes after the families');
  });
});

describe('the kit plays a recording', () => {
  // A page with the kit, an AudioContext that notes the sources it starts and the gains it makes, a
  // clock, and a fetch that answers from `files` (anything else is a 404). hold() keeps the next fetch
  // unanswered until the function it is handed is called.
  function page(files) {
    const clock = { now: 1000 };
    const started = [];
    const gains = [];
    const fetched = [];
    let holding = null;
    const ctx = {
      currentTime: 0, sampleRate: 44100, destination: {},
      createBufferSource() { const node = { connect() {}, start() { started.push(node.buffer); } }; return node; },
      createGain() { const node = { gain: { value: 1 }, connect() {} }; gains.push(node); return node; },
      decodeAudioData(bytes) { return Promise.resolve(Buffer.from(bytes).toString()); },
    };
    const window = { console: { log() {}, warn() {}, error() {} }, Date: { now: () => clock.now } };
    window.window = window;
    window.fetch = (url) => {
      fetched.push(url);
      const name = url.replace('/overlay/objects/sounds/', '');
      const answer = Object.hasOwn(files, name)
        ? { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(Buffer.from(files[name])).buffer }
        : { ok: false, status: 404 };
      if (!holding) return Promise.resolve(answer);
      const hold = holding;
      holding = null;
      return new Promise((resolve) => hold(() => resolve(answer)));
    };
    const context = vm.createContext(window);
    for (const file of ['index.js', 'kit.js']) vm.runInContext(fs.readFileSync(path.join(OBJECTS_DIR, file), 'utf8'), context, { filename: file });
    const K = context.ATLETA_KIT;
    K.registerFamily({ key: 'kittest', order: 99, fonts: [] });
    const synth = [];
    K.registerSound('kitBeep', 'kittest', () => synth.push('kitBeep'));
    K.setAudio(ctx, () => 0.5);
    return { K, clock, fetched, synth, gains, played: () => started.slice(), hold: (fn) => { holding = fn; } };
  }

  test('a sound plays its default recording, and its second version as <key>.2, at its volume, each fetched once', async () => {
    const p = page({ 'kittest/beep.mp3': 'first', 'kittest/beep.2.mp3': 'second' });
    p.K.registerSoundFiles({ kitBeep: ['kittest/beep.mp3', 'kittest/beep.2.mp3'], nope: ['kittest/nope.mp3'] });
    assert.equal(p.K.soundFamilies['kitBeep.2'], 'kittest');
    assert.equal(p.K.isSecondVersion('kitBeep.2'), true);
    assert.equal(p.K.isSecondVersion('kitBeep'), false);
    assert.equal(p.K.secondVersionOf('kitBeep'), 'kitBeep.2');
    assert.equal(p.K.secondVersionOf('kitBeep.2'), null);
    assert.equal(p.K.sounds.nope, undefined, 'a recording of a sound no family registers is passed over');
    assert.equal(p.K.playSound('kitBeep'), true);
    await settle();
    assert.equal(p.K.playSound('kitBeep.2'), true);
    await settle();
    p.K.playSound('kitBeep');
    await settle();
    assert.deepEqual(p.played(), ['first', 'second', 'first']);
    assert.deepEqual(p.gains.map((g) => g.gain.value), [0.5, 0.5, 0.5]);
    assert.deepEqual(p.fetched, ['/overlay/objects/sounds/kittest/beep.mp3', '/overlay/objects/sounds/kittest/beep.2.mp3']);
    assert.deepEqual(p.synth, []);
    assert.equal(p.K.soundFor({ family: 'kittest', sound: 'kitBeep' }, { style_sound: 'kitBeep.2' }), 'kitBeep.2', 'a design may name the second version');
  });

  test('a recording that cannot load plays the synthesized sound, and the next alert tries the file again', async () => {
    const p = page({});
    p.K.registerSoundFiles({ kitBeep: ['kittest/missing.mp3', 'kittest/missing.2.mp3'] });
    p.K.playSound('kitBeep');
    await settle();
    assert.deepEqual(p.synth, ['kitBeep']);
    assert.deepEqual(p.played(), []);
    p.K.playSound('kitBeep');
    await settle();
    assert.equal(p.fetched.length, 2, 'fetched again');
  });

  test('a recording that arrives after its alert has gone is not played, nor is the synthesized sound', async () => {
    const p = page({ 'kittest/beep.mp3': 'first' });
    p.K.registerSoundFiles({ kitBeep: ['kittest/beep.mp3'] });
    let deliver = null;
    p.hold((go) => { deliver = go; });
    p.K.playSound('kitBeep');
    await settle();
    p.clock.now += 2000;
    deliver();
    await settle();
    assert.deepEqual(p.played(), []);
    assert.deepEqual(p.synth, []);
  });

  test('preloadSounds fetches the recordings it is given and passes over today\'s, none and unknown sounds', async () => {
    const p = page({ 'kittest/beep.mp3': 'first' });
    p.K.registerSoundFiles({ kitBeep: ['kittest/beep.mp3'] });
    p.K.preloadSounds(['today', 'none', 'nope', 'kitBeep', 'kitBeep']);
    await settle();
    assert.deepEqual(p.fetched, ['/overlay/objects/sounds/kittest/beep.mp3']);
    p.K.playSound('kitBeep');
    await settle();
    assert.equal(p.fetched.length, 1, 'played from what was loaded');
    assert.deepEqual(p.played(), ['first']);
  });

  test('a page with no AudioContext plays nothing and fetches nothing', () => {
    const p = page({ 'kittest/beep.mp3': 'first' });
    p.K.registerSoundFiles({ kitBeep: ['kittest/beep.mp3'] });
    p.K.setAudio(null);
    assert.equal(p.K.playSound('kitBeep'), false);
    p.K.preloadSounds(['kitBeep']);
    assert.deepEqual(p.fetched, []);
  });
});
