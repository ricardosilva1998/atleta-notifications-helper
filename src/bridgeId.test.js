const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isBridgeId } = require('./bridgeId');

test('an id the Atleta Racing app makes is a bridge id', () => {
  assert.equal(isBridgeId('3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f'), true); // crypto.randomUUID()
  assert.equal(isBridgeId('ABCDEF12'), true);
  assert.equal(isBridgeId('a'.repeat(64)), true);
});

test('anything else is not', () => {
  for (const value of ['', 'short', 'a'.repeat(65), '3f1c2a9e 8b7d', 'id"><img src=x>', "id'onclick", 'id_with_underscore', null, undefined, 12345678, ['3f1c2a9e-8b7d'], { id: '3f1c2a9e-8b7d' }]) {
    assert.equal(isBridgeId(value), false, JSON.stringify(value));
  }
});
