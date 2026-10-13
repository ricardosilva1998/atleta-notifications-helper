'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  COMMAND_RESPONSE_MAX, COMMAND_NAME_MAX, COMMAND_ERRORS, commandCooldownSeconds, singleLine, normalizeCommandName, parseCommand, isUniqueViolation,
} = require('./chatCommands');

describe('normalizeCommandName', () => {
  test('drops one leading ! and spaces, and lower-cases', () => {
    assert.equal(normalizeCommandName('socials'), 'socials');
    assert.equal(normalizeCommandName('!Socials'), 'socials');
    assert.equal(normalizeCommandName('  !Socials  '), 'socials');
    assert.equal(normalizeCommandName('! discord'), 'discord');
    assert.equal(normalizeCommandName('Cmd_2'), 'cmd_2');
  });

  test('a blank name, a lone ! and anything with other characters are refused', () => {
    for (const bad of ['', '   ', '!', '!!', '!!hi', 'two words', 'café', 'a-b', 'a.b', '!<b>', '\n']) {
      assert.equal(normalizeCommandName(bad), null, JSON.stringify(bad));
    }
  });

  test('a name is at most 50 characters', () => {
    assert.equal(COMMAND_NAME_MAX, 50);
    assert.equal(normalizeCommandName('a'.repeat(50)), 'a'.repeat(50));
    assert.equal(normalizeCommandName('a'.repeat(51)), null);
  });

  test('only a string is a name (a repeated form field arrives as an array)', () => {
    for (const bad of [undefined, null, 5, ['a', 'b'], ['ok'], { toString: () => 'ok' }]) {
      assert.equal(normalizeCommandName(bad), null, String(bad));
    }
  });
});

describe('parseCommand', () => {
  test('a good command comes back cleaned up', () => {
    assert.deepEqual(parseCommand({ command: '!Socials', response: '  Follow us on Discord!  ', cooldown: '30' }),
      { command: 'socials', response: 'Follow us on Discord!', cooldown: 30 });
  });

  test('add and update share it: a blank name is name_invalid, never a stored command', () => {
    assert.deepEqual(parseCommand({ command: '', response: 'hi' }), { error: 'name_invalid' });
    assert.deepEqual(parseCommand({ command: '!', response: 'hi' }), { error: 'name_invalid' });
    assert.deepEqual(parseCommand({ response: 'hi' }), { error: 'name_invalid' });
  });

  test('a missing, blank or non-text response is response_required (it used to be a 500)', () => {
    assert.deepEqual(parseCommand({ command: 'hi' }), { error: 'response_required' });
    assert.deepEqual(parseCommand({ command: 'hi', response: '   ' }), { error: 'response_required' });
    assert.deepEqual(parseCommand({ command: 'hi', response: ['a', 'b'] }), { error: 'response_required' });
    assert.deepEqual(parseCommand({ command: 'hi', response: '\r\n' }), { error: 'response_required' });
  });

  test('a response is at most 500 characters, a chat message\'s limit', () => {
    assert.equal(COMMAND_RESPONSE_MAX, 500);
    assert.equal(parseCommand({ command: 'hi', response: 'x'.repeat(500) }).response.length, 500);
    assert.deepEqual(parseCommand({ command: 'hi', response: 'x'.repeat(501) }), { error: 'response_too_long' });
  });

  test('line breaks and other control characters in a response become spaces, so it stays one chat line', () => {
    assert.equal(parseCommand({ command: 'hi', response: 'one\r\ntwo\nthree\u0000four' }).response, 'one two three four');
  });

  test('the cooldown is held to 5-3600 seconds, whatever was typed', () => {
    const cooldown = (value) => parseCommand({ command: 'hi', response: 'x', cooldown: value }).cooldown;
    for (const low of [-100, -1, 0, 1, 4, '0', '-7']) assert.equal(cooldown(low), 5, String(low));
    assert.equal(cooldown(5), 5);
    assert.equal(cooldown('45'), 45);
    assert.equal(cooldown(3600), 3600);
    for (const high of [3601, 999999, '1e9']) assert.equal(cooldown(high), 3600, String(high));
    for (const missing of [undefined, null, '', 'abc', NaN]) assert.equal(cooldown(missing), 5, String(missing));
  });

  test('a missing body is just an invalid name', () => {
    assert.deepEqual(parseCommand(undefined), { error: 'name_invalid' });
    assert.deepEqual(parseCommand(null), { error: 'name_invalid' });
  });

  test('every error code it can return has a message key', () => {
    for (const code of ['name_invalid', 'response_required', 'response_too_long']) assert.ok(COMMAND_ERRORS[code], code);
    assert.ok(COMMAND_ERRORS.duplicate);
  });
});

describe('commandCooldownSeconds (also applied where the chat checks a stored cooldown)', () => {
  test('is held to 5-3600 seconds, and 5 when there is nothing readable', () => {
    for (const low of [-3600, -1, 0, 1, 4, 4.4]) assert.equal(commandCooldownSeconds(low), 5, String(low));
    for (const high of [3601, 86400, 1e9]) assert.equal(commandCooldownSeconds(high), 3600, String(high));
    for (const fine of [5, 30, 3600]) assert.equal(commandCooldownSeconds(fine), fine);
    assert.equal(commandCooldownSeconds('45'), 45);
    for (const missing of [undefined, null, '', 'abc', NaN]) assert.equal(commandCooldownSeconds(missing), 5, String(missing));
  });
});

describe('singleLine', () => {
  test('turns each run of control characters into one space and trims', () => {
    assert.equal(singleLine('a\r\n\r\nb'), 'a b');
    assert.equal(singleLine('\tx\u007Fy\n'), 'x y');
    assert.equal(singleLine(12), '12');
  });
});

describe('isUniqueViolation', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (streamer_id INTEGER NOT NULL, command TEXT NOT NULL, UNIQUE(streamer_id, command))');
  db.prepare('INSERT INTO t VALUES (1, ?)').run('socials');

  test('is true for the error SQLite raises for a name that is already in use', () => {
    let error;
    try { db.prepare('INSERT INTO t VALUES (1, ?)').run('socials'); } catch (e) { error = e; }
    assert.ok(error, 'the insert must fail');
    assert.equal(isUniqueViolation(error), true);
  });

  test('is false for other errors, and for no error', () => {
    let error;
    try { db.prepare('INSERT INTO t VALUES (1, NULL)').run(); } catch (e) { error = e; }
    assert.ok(error);
    assert.equal(isUniqueViolation(error), false, 'a NOT NULL failure is not a duplicate');
    assert.equal(isUniqueViolation(new Error('boom')), false);
    assert.equal(isUniqueViolation(null), false);
    assert.equal(isUniqueViolation(undefined), false);
  });
});
