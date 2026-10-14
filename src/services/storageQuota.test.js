'use strict';

// Room for uploads (services/storageQuota.js), on a temp folder laid out like
// data/. Large files are sparse (their size is set, nothing is written), and
// the free space comes from a fake statfs, so the cases are exact.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const quota = require('./storageQuota');

const MB = 1024 * 1024;
let root;

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-quota-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

// A file of `size` bytes under root, without writing them.
function sized(relative, size) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  fs.truncateSync(file, size);
  return file;
}

// What statfs would say about a volume with `freeMb` MB available.
const volumeWith = (freeMb) => () => ({ bsize: 4096, bavail: (freeMb * MB) / 4096 });

describe('a streamer\'s stored media', () => {
  test('adds up their sounds, sponsor images, reward clips and VTuber models, in their own folders only', () => {
    sized('sounds/5/follow.mp3', 1 * MB);
    sized('sponsors/5/sponsor_1.png', 2 * MB);
    sized('redemptions/5/3_1700000000000.mp4', 3 * MB);
    sized('vtuber-models/5/5_1700000000000_model.vrm', 4 * MB);
    sized('sponsors/6/sponsor_2.png', 50 * MB); // another streamer
    sized('avatars/5/avatar_1.png', 1 * MB); // not media
    sized('sounds/_archive/follow.mp3', 1 * MB); // nobody's
    assert.equal(quota.streamerMediaBytes(5, root), 10 * MB);
    assert.equal(quota.streamerMediaBytes(6, root), 50 * MB);
    assert.equal(quota.streamerMediaBytes(7, root), 0, 'a streamer with no folders');
  });
});

describe('uploadRefusal', () => {
  const ask = (over) => quota.uploadRefusal({ streamerId: 5, bytes: 5 * MB, root, statfs: volumeWith(4000), ...over });

  test('lets an upload through when there is room on the volume and in the streamer\'s quota', () => {
    sized('sponsors/5/sponsor_1.png', 100 * MB);
    assert.equal(ask(), null);
  });

  test('refuses an upload that would leave the volume with less than 200 MB free', () => {
    assert.equal(ask({ statfs: volumeWith(204) }), 'disk', '204 MB free - 5 MB < 200 MB');
    assert.equal(ask({ statfs: volumeWith(205) }), null, 'exactly 200 MB left is enough');
    assert.equal(ask({ statfs: volumeWith(150), media: false }), 'disk', 'any upload, media or not');
  });

  test('refuses an upload that would take the streamer\'s media past 250 MB', () => {
    sized('vtuber-models/5/5_1_big.vrm', 246 * MB);
    assert.equal(ask(), 'quota', '246 + 5 > 250');
    assert.equal(ask({ bytes: 4 * MB }), null, '246 + 4 = 250 is allowed');
  });

  test('counts a replaced file as gone', () => {
    const current = sized('sounds/5/follow.mp3', 8 * MB);
    sized('vtuber-models/5/5_1_big.vrm', 240 * MB);
    assert.equal(ask({ bytes: 9 * MB }), 'quota', '248 + 9 > 250');
    assert.equal(ask({ bytes: 9 * MB, replacing: quota.fileBytes(current) }), null, '248 - 8 + 9 = 249');
  });

  test('profile pictures and issue screenshots (media: false) only need room on the volume', () => {
    sized('vtuber-models/5/5_1_big.vrm', 300 * MB);
    assert.equal(ask({ media: false }), null);
  });

  test('when the free space cannot be read, only the quota is checked', () => {
    const unreadable = () => { throw new Error('ENOSYS'); };
    assert.equal(ask({ statfs: unreadable }), null);
    sized('vtuber-models/5/5_1_big.vrm', 249 * MB);
    assert.equal(ask({ statfs: unreadable }), 'quota');
  });
});

describe('helpers', () => {
  test('freeBytes reads the real volume of a folder that exists, and is null for one that does not', () => {
    assert.ok(quota.freeBytes(root) > 0);
    assert.equal(quota.freeBytes(path.join(root, 'missing')), null);
  });

  test('fileBytes is a file\'s size, or 0 when there is no file', () => {
    assert.equal(quota.fileBytes(sized('sounds/5/raid.mp3', 1234)), 1234);
    assert.equal(quota.fileBytes(path.join(root, 'sounds/5/bits.mp3')), 0);
  });

  test('the limits are 200 MB free and 250 MB per streamer', () => {
    assert.equal(quota.MIN_FREE_BYTES, 200 * MB);
    assert.equal(quota.MEDIA_QUOTA_BYTES, 250 * MB);
  });
});
