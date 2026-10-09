const { test } = require('node:test');
const assert = require('node:assert');
const { encryptKey, decryptKey } = require('../src/services/streamKeyCrypto');

const SECRET = 'a'.repeat(64);

test('encrypt/decrypt round-trips a YouTube-style key', () => {
  const plaintext = 'aaaa-bbbb-cccc-dddd-eeee';
  const ciphertext = encryptKey(plaintext, SECRET);
  assert.notStrictEqual(ciphertext, plaintext);
  assert.match(ciphertext, /^v1:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
  const recovered = decryptKey(ciphertext, SECRET);
  assert.strictEqual(recovered, plaintext);
});

test('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
  const a = encryptKey('hello', SECRET);
  const b = encryptKey('hello', SECRET);
  assert.notStrictEqual(a, b);
  assert.strictEqual(decryptKey(a, SECRET), 'hello');
  assert.strictEqual(decryptKey(b, SECRET), 'hello');
});

test('decrypt rejects tampered ciphertext', () => {
  const ciphertext = encryptKey('hello', SECRET);
  const last = ciphertext.slice(-1);
  const flipped = ciphertext.slice(0, -1) + (last === '0' ? '1' : '0');
  assert.throws(() => decryptKey(flipped, SECRET));
});

test('decrypt rejects wrong secret', () => {
  const ciphertext = encryptKey('hello', SECRET);
  assert.throws(() => decryptKey(ciphertext, 'b'.repeat(64)));
});

test('encryptKey returns null for null/empty input', () => {
  assert.strictEqual(encryptKey(null, SECRET), null);
  assert.strictEqual(encryptKey(undefined, SECRET), null);
  assert.strictEqual(encryptKey('', SECRET), null);
});

test('decryptKey returns null for null/empty input', () => {
  assert.strictEqual(decryptKey(null, SECRET), null);
  assert.strictEqual(decryptKey(undefined, SECRET), null);
  assert.strictEqual(decryptKey('', SECRET), null);
});

test('encryptKey throws if secret is not 64 hex chars', () => {
  assert.throws(() => encryptKey('hi', 'short'));
  assert.throws(() => encryptKey('hi', ''));
  assert.throws(() => encryptKey('hi', null));
});

test('decryptKey throws on malformed ciphertext (wrong version prefix)', () => {
  assert.throws(() => decryptKey('v2:aa:bb:cc', SECRET));
});

test('decryptKey throws on malformed ciphertext (missing parts)', () => {
  assert.throws(() => decryptKey('v1:aa:bb', SECRET));
});
