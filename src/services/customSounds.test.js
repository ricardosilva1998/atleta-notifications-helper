'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SOUND_TYPES, soundFilePath, soundVersions, soundUrls, soundStatus,
  storedSoundMimeType, migrateLegacySounds,
} = require('./customSounds');

const LEGACY_TYPES = ['follow', 'subscription', 'bits', 'donation'];

// Every test gets its own empty sounds folder.
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-sounds-test-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function write(rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Collects what the migration logs, so the test output stays clean.
function quietLogger() {
  const lines = [];
  return { lines, log: (m) => lines.push(m), error: (m) => lines.push(m) };
}

describe('soundFilePath', () => {
  test('puts a sound in its streamer\'s own folder', () => {
    assert.equal(soundFilePath(13, 'follow', root), path.join(root, '13', 'follow.mp3'));
    assert.equal(soundFilePath(7, 'giveaway_winner', root), path.join(root, '7', 'giveaway_winner.mp3'));
  });

  test('accepts every alert type, giveaway_winner included', () => {
    assert.deepEqual(SOUND_TYPES, [
      'follow', 'subscription', 'bits', 'donation', 'raid',
      'yt_superchat', 'yt_member', 'yt_giftmember', 'giveaway_winner',
    ]);
    for (const type of SOUND_TYPES) assert.ok(soundFilePath(1, type, root), type);
  });

  test('rejects types outside the allowlist', () => {
    for (const type of ['', 'FOLLOW', 'follow.mp3', 'chat', 'sponsor', 'redemption', 'constructor', '__proto__', 'toString', null, undefined, 42]) {
      assert.equal(soundFilePath(13, type, root), null, `type ${String(type)} must be rejected`);
    }
  });

  test('rejects path traversal in the type', () => {
    for (const type of ['..', '../follow', '../../etc/passwd', 'follow/../../x', '13/follow', '..%2Ffollow', 'follow\0']) {
      assert.equal(soundFilePath(13, type, root), null, `type ${JSON.stringify(type)} must be rejected`);
    }
  });

  test('rejects anything but a positive integer streamer id', () => {
    for (const id of [0, -1, 1.5, NaN, Infinity, '13', '../13', '_archive', null, undefined, {}]) {
      assert.equal(soundFilePath(id, 'follow', root), null, `id ${String(id)} must be rejected`);
    }
  });
});

describe('soundVersions, soundUrls and soundStatus', () => {
  const T1 = new Date('2026-10-01T10:00:00.123Z');
  const T2 = new Date('2026-10-02T11:30:00.456Z');

  test('list only the stored types, versioned by modification time', () => {
    const file = write('13/follow.mp3', 'a');
    fs.utimesSync(file, T1, T1);
    assert.deepEqual(soundVersions(13, root), { follow: T1.getTime() });
  });

  test('a replaced sound gets a new version', () => {
    const file = write('13/bits.mp3', 'a');
    fs.utimesSync(file, T1, T1);
    const before = soundVersions(13, root).bits;
    fs.writeFileSync(file, 'b');
    fs.utimesSync(file, T2, T2);
    assert.notEqual(soundVersions(13, root).bits, before);
    assert.equal(soundVersions(13, root).bits, T2.getTime());
  });

  test('never list another streamer\'s sounds or the root files', () => {
    write('7/bits.mp3', 'x');
    write('raid.mp3', 'x');
    write('_archive/follow.mp3', 'x');
    assert.deepEqual(soundVersions(13, root), {});
  });

  test('soundUrls points at the streamer\'s token route with ?v=<mtimeMs>', () => {
    fs.utimesSync(write('13/follow.mp3', 'a'), T1, T1);
    fs.utimesSync(write('13/giveaway_winner.mp3', 'a'), T2, T2);
    assert.deepEqual(soundUrls({ id: 13, overlay_token: 'tok-13' }, root), {
      follow: `/overlay/sounds/tok-13/follow?v=${T1.getTime()}`,
      giveaway_winner: `/overlay/sounds/tok-13/giveaway_winner?v=${T2.getTime()}`,
    });
  });

  test('soundUrls is empty without an overlay token (no overlay can play them)', () => {
    write('13/follow.mp3', 'a');
    assert.deepEqual(soundUrls({ id: 13, overlay_token: null }, root), {});
    assert.deepEqual(soundUrls(null, root), {});
  });

  test('soundStatus flags every type and carries the URLs', () => {
    fs.utimesSync(write('13/donation.mp3', 'a'), T1, T1);
    const status = soundStatus({ id: 13, overlay_token: 'tok-13' }, root);
    assert.deepEqual(Object.keys(status.custom), SOUND_TYPES);
    for (const type of SOUND_TYPES) assert.equal(status.custom[type], type === 'donation', type);
    assert.deepEqual(status.urls, { donation: `/overlay/sounds/tok-13/donation?v=${T1.getTime()}` });
  });
});

describe('storedSoundMimeType', () => {
  test('names the format of the stored bytes', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1'), Buffer.alloc(32)]);
    assert.equal(await storedSoundMimeType(write('13/follow.mp3', wav)), 'audio/wav');
    const mp3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(32)]);
    assert.equal(await storedSoundMimeType(write('13/bits.mp3', mp3)), 'audio/mpeg');
  });

  test('serves unrecognised legacy bytes as audio/mpeg, as the old static route did', async () => {
    assert.equal(await storedSoundMimeType(write('13/raid.mp3', 'short')), 'audio/mpeg');
  });

  test('is null when there is no file', async () => {
    assert.equal(await storedSoundMimeType(path.join(root, '13', 'follow.mp3')), null);
    fs.mkdirSync(path.join(root, '13', 'bits.mp3'), { recursive: true });
    assert.equal(await storedSoundMimeType(path.join(root, '13', 'bits.mp3')), null);
  });
});

describe('migrateLegacySounds', () => {
  function writeLegacy(types = LEGACY_TYPES) {
    for (const type of types) write(`${type}.mp3`, `legacy-${type}`);
  }

  test('moves the four shared sounds into streamer 13\'s folder', () => {
    writeLegacy();
    const asked = [];
    const logger = quietLogger();
    const moves = migrateLegacySounds({ root, ownerExists: (id) => { asked.push(id); return id === 13; }, logger });

    assert.equal(moves.length, 4);
    for (const type of LEGACY_TYPES) {
      assert.equal(read(`13/${type}.mp3`), `legacy-${type}`, type);
      assert.equal(exists(`${type}.mp3`), false, `root ${type}.mp3 must be gone`);
    }
    assert.ok(asked.length > 0 && asked.every((id) => id === 13));
    assert.equal(logger.lines.length, 4, 'one log line per move');
    assert.equal(exists('_archive'), false);
  });

  test('a second run is a no-op', () => {
    writeLegacy();
    migrateLegacySounds({ root, ownerExists: () => true, logger: quietLogger() });
    const logger = quietLogger();
    const moves = migrateLegacySounds({ root, ownerExists: () => true, logger });
    assert.deepEqual(moves, []);
    assert.deepEqual(logger.lines, []);
    for (const type of LEGACY_TYPES) assert.equal(read(`13/${type}.mp3`), `legacy-${type}`);
  });

  test('archives the sounds when streamer 13 does not exist', () => {
    writeLegacy();
    const logger = quietLogger();
    const moves = migrateLegacySounds({ root, ownerExists: () => false, logger });
    assert.equal(moves.length, 4);
    for (const type of LEGACY_TYPES) {
      assert.equal(read(`_archive/${type}.mp3`), `legacy-${type}`, type);
      assert.equal(exists(`${type}.mp3`), false);
    }
    assert.equal(exists('13'), false);
    assert.equal(logger.lines.length, 4);
  });

  test('archives a sound streamer 13 already has, keeping theirs', () => {
    writeLegacy();
    write('13/follow.mp3', 'own-follow');
    migrateLegacySounds({ root, ownerExists: () => true, logger: quietLogger() });
    assert.equal(read('13/follow.mp3'), 'own-follow');
    assert.equal(read('_archive/follow.mp3'), 'legacy-follow');
    for (const type of ['subscription', 'bits', 'donation']) assert.equal(read(`13/${type}.mp3`), `legacy-${type}`);
  });

  test('never overwrites a file already in the archive', () => {
    writeLegacy(['bits']);
    write('_archive/bits.mp3', 'older-bits');
    migrateLegacySounds({ root, ownerExists: () => false, logger: quietLogger() });
    assert.equal(read('_archive/bits.mp3'), 'older-bits');
    const archived = fs.readdirSync(path.join(root, '_archive')).filter((f) => f !== 'bits.mp3');
    assert.equal(archived.length, 1);
    assert.match(archived[0], /^bits-\d+\.mp3$/);
    assert.equal(read(`_archive/${archived[0]}`), 'legacy-bits');
  });

  test('leaves every other file alone', () => {
    write('raid.mp3', 'legacy-raid');
    write('notes.txt', 'keep');
    write('7/follow.mp3', 'streamer-7');
    const moves = migrateLegacySounds({ root, ownerExists: () => true, logger: quietLogger() });
    assert.deepEqual(moves, []);
    assert.equal(read('raid.mp3'), 'legacy-raid');
    assert.equal(read('notes.txt'), 'keep');
    assert.equal(read('7/follow.mp3'), 'streamer-7');
    assert.equal(exists('13'), false);
  });

  test('does nothing when the sounds folder does not exist', () => {
    const missing = path.join(root, 'missing');
    const moves = migrateLegacySounds({ root: missing, ownerExists: () => true, logger: quietLogger() });
    assert.deepEqual(moves, []);
    assert.equal(fs.existsSync(missing), false);
  });
});
