'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { containsLink, capsPercent, symbolPercent } = require('./chatFilters');

describe('symbolPercent', () => {
  test('letters and numbers of any script are never symbols', () => {
    for (const text of [
      'こんにちは、今日のレースすごかった！',
      '你好，今天的比赛太精彩了',
      'Привет всем, отличная гонка сегодня',
      'مرحبا الجميع سباق رائع',
      'Que corrida incrível, parabéns à equipa!',
      '١٢٣٤٥ ١٢٣٤٥',
      '\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}',
    ]) {
      assert.ok(symbolPercent(text) < 10, `${text} -> ${symbolPercent(text)}`);
    }
  });

  test('counts ASCII punctuation and symbols', () => {
    assert.equal(symbolPercent('!!!!!!!!'), 100);
    assert.equal(symbolPercent('$$$ ### @@@'), 82);
    assert.equal(symbolPercent('hello world!'), 8);
  });

  test('skips messages shorter than 5 characters', () => {
    assert.equal(symbolPercent('!!!!'), null);
  });
});

describe('containsLink', () => {
  test('detects links with a scheme, www. or a real TLD', () => {
    for (const text of [
      'https://example.com',
      'go to HTTP://EXAMPLE.ORG/page',
      'www.example.com',
      'check bit.ly/3abcd for free skins',
      'join discord.gg/abcdef',
      'watch youtu.be/xyz',
      'visit example.co.uk today',
      'my-site.tv',
      'new.app is out',
    ]) {
      assert.equal(containsLink(text), true, text);
    }
  });

  test('ignores typos and abbreviations that are not links', () => {
    for (const text of [
      'ok.so what now',
      'e.g. 3.5 seconds faster, i.e. great',
      'awww...so cute',
      'owww.that hurt',
      'file.txt',
      'node.js is great',
      'v1.2.3',
      'www.',
      'the U.S.A. grand prix',
    ]) {
      assert.equal(containsLink(text), false, text);
    }
  });
});

describe('capsPercent', () => {
  test('measures upper-case letters, including other scripts', () => {
    assert.equal(capsPercent('HELLO EVERYONE'), 100);
    assert.equal(capsPercent('Hello Everyone'), 15);
    assert.equal(capsPercent('ПРИВЕТ ВСЕМ'), 100);
  });

  test('skips messages with fewer than 8 letters', () => {
    assert.equal(capsPercent('HELLO'), null);
    assert.equal(capsPercent('OK OK OK'), null);
    assert.equal(capsPercent('こんにちは、今日のレースすごかった'), null);
  });

  test('ignores Twitch emotes, using the message emotes tag', () => {
    // tmi.js emotes tag: emote id -> ["start-end", ...] character positions.
    const lul = { 425618: ['0-2', '4-6', '8-10', '12-14'] };
    assert.equal(capsPercent('LUL LUL LUL LUL'), 100);
    assert.equal(capsPercent('LUL LUL LUL LUL', lul), null);
    assert.equal(capsPercent('LUL LUL LUL LUL hello there', lul), 0);
    assert.equal(capsPercent('PogChamp WHAT A RACE', { 88: ['0-7'] }), 100);
  });

  test('emote positions count characters, so emoji before an emote do not shift them', () => {
    const text = '\u{1F600} LUL LUL LUL hello';
    assert.equal(capsPercent(text, { 425618: ['2-4', '6-8', '10-12'] }), null);
  });

  test('ignores malformed or out-of-range emote positions', () => {
    assert.equal(capsPercent('HELLO EVERYONE', { 1: ['50-60', 'x-y', '9-2'] }), 100);
    assert.equal(capsPercent('HELLO EVERYONE', null), 100);
  });
});
