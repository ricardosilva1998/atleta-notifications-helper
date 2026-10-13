'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTwitchLogin } = require('./twitchLogin');

describe('normalizeTwitchLogin', () => {
  test('keeps a plain login and lowercases it', () => {
    assert.equal(normalizeTwitchLogin('andre_vilela_'), 'andre_vilela_');
    assert.equal(normalizeTwitchLogin('Andre_Vilela_'), 'andre_vilela_');
    assert.equal(normalizeTwitchLogin('a'), 'a');
    assert.equal(normalizeTwitchLogin('x'.repeat(25)), 'x'.repeat(25));
  });

  test('strips surrounding whitespace and a leading @', () => {
    assert.equal(normalizeTwitchLogin('  some_streamer \n'), 'some_streamer');
    assert.equal(normalizeTwitchLogin('@Some_Streamer'), 'some_streamer');
    assert.equal(normalizeTwitchLogin(' @some_streamer '), 'some_streamer');
  });

  test('takes the channel out of a pasted address', () => {
    for (const pasted of [
      'twitch.tv/Some_Streamer',
      'https://twitch.tv/some_streamer',
      'http://www.twitch.tv/some_streamer',
      'HTTPS://WWW.TWITCH.TV/Some_Streamer/',
      'https://m.twitch.tv/some_streamer',
      'https://go.twitch.tv/some_streamer',
      'https://www.twitch.tv/some_streamer/videos',
      'https://www.twitch.tv/some_streamer?sr=a&t=1',
      'https://www.twitch.tv/some_streamer#chat',
      'https://www.twitch.tv/@some_streamer',
    ]) {
      assert.equal(normalizeTwitchLogin(pasted), 'some_streamer', pasted);
    }
  });

  test('refuses anything that cannot be a Twitch login', () => {
    for (const bad of [
      '', '   ', '@', 'twitch.tv/', 'https://www.twitch.tv/',
      'x'.repeat(26),
      'some streamer', 'some-streamer', 'some.streamer', 'streamer!', 'stréamer', 'ｓtreamer',
      'a​b', // zero-width space inside the name
    ]) {
      assert.equal(normalizeTwitchLogin(bad), null, JSON.stringify(bad));
    }
  });

  test('refuses other sites, including look-alike hosts', () => {
    for (const bad of [
      'https://example.com/some_streamer',
      'https://notwitch.tv/some_streamer',
      'https://twitch.tv.example.com/some_streamer',
      'ftp://twitch.tv/some_streamer',
    ]) {
      assert.equal(normalizeTwitchLogin(bad), null, bad);
    }
  });

  test('refuses values that are not text (repeated form fields arrive as arrays)', () => {
    for (const bad of [undefined, null, 42, ['a', 'b'], { login: 'a' }]) {
      assert.equal(normalizeTwitchLogin(bad), null, JSON.stringify(bad));
    }
  });
});
