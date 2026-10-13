'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ── Stubs: db, config, fetch, console ────────────────────────────────

const state = { bannedWords: [], modLog: [] };

const dbStub = {
  getBannedWords: () => state.bannedWords,
  addModLogEntry: (...args) => state.modLog.push(args),
};

// src/config.js exits the process without real env vars, so it is stubbed.
// The token is synthetic.
const configStub = {
  bot: { twitchToken: 'oauth:synthetic-bot-token' },
  twitch: { clientId: 'synthetic-app-client-id' },
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename.endsWith(`${path.sep}chatModeration.js`)) {
    if (request === '../db') return dbStub;
    if (request === '../config') return configStub;
  }
  return origLoad.call(this, request, parent, isMain);
};
const mod = require('./chatModeration');
Module._load = origLoad;

const realFetch = global.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let logs;

beforeEach(() => {
  state.bannedWords = [];
  state.modLog = [];
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => logs.push({ level, text: args.join(' ') });
  }
  global.fetch = async () => { throw new Error('unexpected network call'); };
});

afterEach(() => {
  Object.assign(console, realConsole);
  global.fetch = realFetch;
});

let nextWordId = 1;
function bannedWord(word, isRegex = false) {
  return { id: nextWordId++, streamer_id: 1, word, is_regex: isRegex ? 1 : 0, created_at: '2026-01-01 12:00:00' };
}

// ── C5: banned words ─────────────────────────────────────────────────

describe('checkBannedWords', () => {
  test('regex and plain words match case-insensitively', () => {
    state.bannedWords = [bannedWord('sp[a@4]m+'), bannedWord('sp[a@4]m+', true), bannedWord('Scam')];
    assert.ok(mod.checkBannedWords('total SP@MMM here', 1));
    assert.ok(mod.checkBannedWords('this is a sCaM', 1));
    assert.equal(mod.checkBannedWords('perfectly fine', 1), null);
  });

  test('a stored regex that fails validation is matched as literal text', () => {
    state.bannedWords = [bannedWord('(a+)+$', true)];
    assert.equal(mod.checkBannedWords('a'.repeat(40), 1), null);
    assert.ok(mod.checkBannedWords('someone typed (A+)+$ here', 1));
  });

  test('only the first 500 characters of a message are tested', () => {
    state.bannedWords = [bannedWord('scam'), bannedWord('fr[e3]{2}', true)];
    assert.equal(mod.checkBannedWords('x'.repeat(500) + ' scam fr33', 1), null);
    assert.ok(mod.checkBannedWords('x'.repeat(490) + ' scam', 1));
    assert.ok(mod.checkBannedWords('x'.repeat(490) + ' fr33', 1));
  });

  test('a change to the word list applies to the next message', () => {
    state.bannedWords = [bannedWord('alpha')];
    assert.ok(mod.checkBannedWords('alpha', 1));
    state.bannedWords = [bannedWord('beta', true)];
    assert.equal(mod.checkBannedWords('alpha', 1), null);
    assert.ok(mod.checkBannedWords('BETA', 1));
  });
});
