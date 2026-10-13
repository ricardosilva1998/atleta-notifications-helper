'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { signLink, verifyLink, LINK_TTL_SECONDS } = require('./linkSignature');

const SECRET = 'test-secret-'.padEnd(64, 'x');
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const STREAMER = 13;
const DISCORD = '700000000000000001';

function signed(overrides = {}) {
  return signLink({ streamerId: STREAMER, discordId: DISCORD, now: NOW, ...overrides }, SECRET);
}

describe('signLink', () => {
  test('carries streamer_id, discord_id, exp and a signature', () => {
    const link = signed();
    assert.deepEqual(Object.keys(link), ['streamer_id', 'discord_id', 'exp', 'sig']);
    assert.equal(link.streamer_id, '13');
    assert.equal(link.discord_id, DISCORD);
    assert.equal(Number(link.exp), NOW / 1000 + LINK_TTL_SECONDS);
    assert.equal(LINK_TTL_SECONDS, 15 * 60);
    assert.match(link.sig, /^[A-Za-z0-9_-]{43}$/);
  });
});

describe('verifyLink', () => {
  test('accepts a link it signed, until it expires', () => {
    const link = signed();
    assert.deepEqual(verifyLink(link, SECRET, NOW), { ok: true, streamerId: 13, discordId: DISCORD });
    assert.equal(verifyLink(link, SECRET, NOW + LINK_TTL_SECONDS * 1000).ok, true, 'still valid at the expiry second');
  });

  test('survives a round trip through a URL query string', () => {
    const query = Object.fromEntries(new URLSearchParams(new URLSearchParams(signed()).toString()));
    assert.equal(verifyLink(query, SECRET, NOW).ok, true);
  });

  test('refuses an expired link', () => {
    const link = signed();
    assert.deepEqual(verifyLink(link, SECRET, NOW + (LINK_TTL_SECONDS + 1) * 1000), { ok: false, reason: 'expired' });
  });

  test('refuses a link whose fields were changed', () => {
    const link = signed();
    assert.deepEqual(verifyLink({ ...link, discord_id: '700000000000000002' }, SECRET, NOW), { ok: false, reason: 'bad_signature' });
    assert.deepEqual(verifyLink({ ...link, streamer_id: '14' }, SECRET, NOW), { ok: false, reason: 'bad_signature' });
    assert.deepEqual(verifyLink({ ...link, exp: String(Number(link.exp) + 86400) }, SECRET, NOW), { ok: false, reason: 'bad_signature' });
  });

  test('refuses a changed or truncated signature without throwing', () => {
    const link = signed();
    const flipped = (link.sig[0] === 'A' ? 'B' : 'A') + link.sig.slice(1);
    assert.deepEqual(verifyLink({ ...link, sig: flipped }, SECRET, NOW), { ok: false, reason: 'bad_signature' });
    assert.deepEqual(verifyLink({ ...link, sig: link.sig.slice(0, 20) }, SECRET, NOW), { ok: false, reason: 'malformed' });
  });

  test('refuses a link signed with another secret', () => {
    const link = signLink({ streamerId: STREAMER, discordId: DISCORD, now: NOW }, 'another-secret'.padEnd(64, 'y'));
    assert.deepEqual(verifyLink(link, SECRET, NOW), { ok: false, reason: 'bad_signature' });
  });

  test('refuses the old unsigned /link URL and missing fields', () => {
    assert.deepEqual(verifyLink({ streamer_id: '13', discord_id: DISCORD }, SECRET, NOW), { ok: false, reason: 'missing' });
    assert.deepEqual(verifyLink({}, SECRET, NOW), { ok: false, reason: 'missing' });
    assert.deepEqual(verifyLink(undefined, SECRET, NOW), { ok: false, reason: 'missing' });
  });

  test('refuses malformed fields, including repeated query parameters', () => {
    const link = signed();
    assert.deepEqual(verifyLink({ ...link, streamer_id: '13abc' }, SECRET, NOW), { ok: false, reason: 'malformed' });
    assert.deepEqual(verifyLink({ ...link, discord_id: 'someone' }, SECRET, NOW), { ok: false, reason: 'malformed' });
    assert.deepEqual(verifyLink({ ...link, exp: '-5' }, SECRET, NOW), { ok: false, reason: 'malformed' });
    assert.deepEqual(verifyLink({ ...link, discord_id: [DISCORD, '700000000000000002'] }, SECRET, NOW), { ok: false, reason: 'malformed' });
  });

  test('a shorter lifetime can be asked for', () => {
    const link = signed({ ttlSeconds: 600 });
    assert.equal(verifyLink(link, SECRET, NOW + 600 * 1000).ok, true);
    assert.deepEqual(verifyLink(link, SECRET, NOW + 601 * 1000), { ok: false, reason: 'expired' });
  });
});
