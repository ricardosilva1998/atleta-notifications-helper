'use strict';

// The AES-256-GCM helper for secrets at rest. Keys and values are synthetic.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PREFIX, isValidKey, parseKey, isSealed, seal, open } = require('./secretBox');

const KEY = '0123456789abcdef'.repeat(4);
const OTHER_KEY = 'fedcba9876543210'.repeat(4);

// The bytes inside a sealed value: iv (12) | tag (16) | ciphertext.
const bytesOf = (sealed) => Buffer.from(sealed.slice(PREFIX.length), 'base64');
const sealedFrom = (bytes) => PREFIX + bytes.toString('base64');

test('a sealed value opens to the same text, and is enc:v1: + base64 of iv | 16-byte tag | ciphertext', () => {
  for (const text of ['synthetic-access-token', '', 'ünïcødé ✓ 🎉', 'x'.repeat(2000)]) {
    const sealed = seal(text, KEY);
    assert.ok(sealed.startsWith('enc:v1:'), sealed);
    assert.match(sealed.slice(PREFIX.length), /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(bytesOf(sealed).length, 12 + 16 + Buffer.byteLength(text), 'iv + tag + ciphertext of the same length');
    if (text) assert.ok(!sealed.includes(text), 'the text does not show');
    assert.equal(open(sealed, KEY), text);
  }
});

test('the same text sealed twice gives two different values (a new IV each time)', () => {
  const a = seal('synthetic-refresh-token', KEY);
  const b = seal('synthetic-refresh-token', KEY);
  assert.notEqual(a, b);
  assert.notDeepEqual(bytesOf(a).subarray(0, 12), bytesOf(b).subarray(0, 12));
  assert.equal(open(a, KEY), 'synthetic-refresh-token');
  assert.equal(open(b, KEY), 'synthetic-refresh-token');
});

test('the key can be given as 64 hex characters (either case) or as 32 bytes', () => {
  const sealed = seal('synthetic', KEY.toUpperCase());
  assert.equal(open(sealed, KEY), 'synthetic');
  assert.equal(open(sealed, Buffer.from(KEY, 'hex')), 'synthetic');
  assert.equal(open(seal('synthetic', parseKey(KEY)), KEY), 'synthetic');
});

test('a changed value throws instead of decrypting: any byte of the IV, the tag or the ciphertext', () => {
  const sealed = seal('synthetic-access-token', KEY);
  const bytes = bytesOf(sealed);
  for (let i = 0; i < bytes.length; i++) {
    const changed = Buffer.from(bytes);
    changed[i] ^= 0x01;
    assert.throws(() => open(sealedFrom(changed), KEY), undefined, `byte ${i}`);
  }
});

test('a changed character of the text throws, including base64 that Node would still decode', () => {
  const sealed = seal('synthetic-access-token', KEY);
  const last = sealed.slice(-1);
  assert.throws(() => open(sealed.slice(0, -1) + (last === 'A' ? 'B' : 'A'), KEY));
  assert.throws(() => open(`${sealed}\n`, KEY), /base64/);
  assert.throws(() => open(`${sealed.slice(0, 20)} ${sealed.slice(20)}`, KEY), /base64/);
  // '=' padding dropped: Node decodes it all the same, the format does not accept it.
  const padded = [seal('a', KEY), seal('ab', KEY), seal('abc', KEY)].find((value) => value.endsWith('='));
  assert.ok(padded, 'one of the three lengths needs padding');
  assert.throws(() => open(padded.replace(/=+$/, ''), KEY), /base64/);
});

test('a truncated tag is refused: only the full 16 bytes are accepted', () => {
  const sealed = seal('synthetic-access-token', KEY);
  const bytes = bytesOf(sealed);
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const ciphertext = bytes.subarray(28);
  // The 4-byte tag the old stream-key format let through, and every other short length.
  for (const length of [0, 1, 4, 8, 12, 15]) {
    const cut = Buffer.concat([iv, tag.subarray(0, length), ciphertext]);
    assert.throws(() => open(sealedFrom(cut), KEY), undefined, `tag of ${length} bytes`);
  }
  // Too short to hold an IV and a tag at all.
  assert.throws(() => open(sealedFrom(Buffer.concat([iv, tag.subarray(0, 4)])), KEY), /too short/);
  assert.throws(() => open(PREFIX, KEY), /too short/);
});

test('the wrong key throws', () => {
  assert.throws(() => open(seal('synthetic', KEY), OTHER_KEY));
});

test('a bad key is refused, for sealing and for opening', () => {
  const sealed = seal('synthetic', KEY);
  const bad = [undefined, null, '', 'short', KEY.slice(0, 63), `${KEY}0`, `${KEY.slice(0, 62)}zz`, ` ${KEY.slice(1)}`, 42, Buffer.alloc(16), Buffer.alloc(33)];
  for (const key of bad) {
    assert.throws(() => seal('synthetic', key), /encryption key/, String(key));
    assert.throws(() => open(sealed, key), /encryption key/, String(key));
  }
  assert.equal(isValidKey(KEY), true);
  assert.equal(isValidKey(KEY.toUpperCase()), true);
  for (const key of bad.filter((k) => !Buffer.isBuffer(k))) assert.equal(isValidKey(key), false, String(key));
});

test('only text in the sealed format is opened; anything else throws', () => {
  for (const value of ['synthetic-plain-token', 'v1:aa:bb:cc', 'enc:v2:AAAA', null, undefined, 42]) {
    assert.throws(() => open(value, KEY), /Not a sealed value/, String(value));
  }
  assert.throws(() => seal(null, KEY), TypeError);
  assert.throws(() => seal(42, KEY), TypeError);
});

test('isSealed tells the stored format apart from plain text', () => {
  assert.equal(isSealed(seal('synthetic', KEY)), true);
  for (const value of ['synthetic-plain-token', '', null, undefined, 7, 'ENC:V1:AAAA', ' enc:v1:AAAA']) {
    assert.equal(isSealed(value), false, String(value));
  }
});

test('a value sealed by another implementation of the same format opens (the format is plain AES-256-GCM)', () => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update('synthetic-interop', 'utf8'), cipher.final()]);
  const sealed = sealedFrom(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
  assert.equal(open(sealed, KEY), 'synthetic-interop');
});
