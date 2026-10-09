const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function getKey(secretHex) {
  if (!secretHex || secretHex.length !== 64) {
    throw new Error('MULTISTREAM_KEY_SECRET must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(secretHex, 'hex');
}

function encryptKey(plaintext, secretHex) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey(secretHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptKey(ciphertext, secretHex) {
  if (ciphertext == null || ciphertext === '') return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('invalid ciphertext format');
  }
  const [, ivHex, tagHex, encHex] = parts;
  const key = getKey(secretHex);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptKey, decryptKey };
