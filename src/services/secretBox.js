'use strict';

// Encrypts short secrets kept at rest (OAuth tokens, stream keys) with
// AES-256-GCM. A sealed value is text:
//
//   enc:v1:<base64 of iv (12 bytes) | auth tag (16 bytes) | ciphertext>
//
// with a new random IV every time. The key is 32 bytes, written as 64 hex
// characters (generate one with `openssl rand -hex 32`). Opening checks the
// whole 16-byte tag, so a changed or cut value, or the wrong key, throws
// instead of decrypting.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_HEX = /^[0-9a-fA-F]{64}$/;

function isValidKey(keyHex) {
  return typeof keyHex === 'string' && KEY_HEX.test(keyHex);
}

// The key as bytes: 64 hex characters, or a Buffer of 32 bytes as it is.
function parseKey(key) {
  if (Buffer.isBuffer(key)) {
    if (key.length !== KEY_BYTES) throw new Error(`The encryption key must be ${KEY_BYTES} bytes`);
    return key;
  }
  if (!isValidKey(key)) throw new Error('The encryption key must be 64 hex characters (32 bytes)');
  return Buffer.from(key, 'hex');
}

// Whether a stored value is in the sealed format (says nothing about the key).
function isSealed(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function seal(plaintext, key) {
  if (typeof plaintext !== 'string') throw new TypeError('Only text can be sealed');
  const keyBytes = parseKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBytes, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function open(sealed, key) {
  if (!isSealed(sealed)) throw new Error('Not a sealed value');
  const body = sealed.slice(PREFIX.length);
  const bytes = Buffer.from(body, 'base64');
  // Only the exact text seal() writes: base64 that decodes to other bytes, or
  // that has characters base64 ignores, is refused before decrypting.
  if (bytes.toString('base64') !== body) throw new Error('Sealed value is not valid base64');
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error('Sealed value is too short');
  const keyBytes = parseKey(key);
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);
  // authTagLength pins the tag at 16 bytes: a shorter tag is refused, not checked
  // on fewer bytes.
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBytes, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { PREFIX, isValidKey, parseKey, isSealed, seal, open };
