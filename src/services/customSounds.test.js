'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SOUND_TYPES, soundFilePath, soundVersions, soundUrls, soundStatus,
  storedSoundMimeType,
} = require('./customSounds');

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
