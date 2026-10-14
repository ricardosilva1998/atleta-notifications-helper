'use strict';

// Multistream stream keys at rest. Kept under this name for the code that
// uses it; the encryption itself is secretBox.js (AES-256-GCM, enc:v1: values).
// The secret is MULTISTREAM_KEY_SECRET (64 hex characters).

const { seal, open } = require('./secretBox');

function encryptKey(plaintext, secretHex) {
  if (plaintext == null || plaintext === '') return null;
  return seal(String(plaintext), secretHex);
}

function decryptKey(ciphertext, secretHex) {
  if (ciphertext == null || ciphertext === '') return null;
  return open(ciphertext, secretHex);
}

module.exports = { encryptKey, decryptKey };
