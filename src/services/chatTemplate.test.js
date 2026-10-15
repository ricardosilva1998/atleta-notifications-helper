'use strict';

// The chat thank-you templates are filled with text that viewers choose (names,
// donation and sub messages). Pure module: no stubs needed.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  fillChatTemplate,
  stripCommandPrefix,
  joinNames,
  NAME_MAX,
  MESSAGE_MAX,
  RESULT_MAX,
} = require('./chatTemplate');

const DONATION = '{username} donated {amount}! {message}';

describe('fillChatTemplate', () => {
  test('fills every placeholder it has a value for and leaves the others', () => {
    assert.equal(
      fillChatTemplate(DONATION, { username: 'BigSponsor', amount: 'USD 25', message: 'Keep racing!' }),
      'BigSponsor donated USD 25! Keep racing!'
    );
    assert.equal(fillChatTemplate('Tier {tier} from {username}', { username: 'A' }), 'Tier {tier} from A');
    assert.equal(fillChatTemplate('{username} raided with {viewers}', { username: 'R', viewers: 0 }), 'R raided with 0');
    assert.equal(fillChatTemplate('{username} sent {message}', { username: 'A', message: null }), 'A sent');
  });

  test('"$&", "$\'" and the other replacement patterns in a value are plain text', () => {
    for (const pattern of ['$&', "$'", '$`', '$$', '$1', '$<name>']) {
      const value = pattern.repeat(5);
      assert.equal(
        fillChatTemplate(DONATION, { username: value, amount: 'USD 5', message: value }),
        `${value} donated USD 5! ${value}`,
        pattern
      );
    }
  });

  test('one donation stays one short line, however the text tries to repeat it', () => {
    const line = fillChatTemplate(DONATION, { username: "$'$'$'$'", amount: 'USD 5', message: "$&$&$&$&$&$&$'$'" });
    assert.ok(line.length < 60, line);
  });

  test('a value that contains a placeholder is not filled in again', () => {
    assert.equal(
      fillChatTemplate(DONATION, { username: '{message}{message}', amount: '{amount}', message: 'hi' }),
      '{message}{message} donated {amount}! hi'
    );
  });

  test('a name or message cannot start the line with another bot\'s command or a chat command', () => {
    for (const lead of ['!', '/', '.', '\\', '!!', ' ! ', '.\\/!', '\n/']) {
      const line = fillChatTemplate(DONATION, { username: `${lead}somecommand !word`, amount: 'USD 5', message: `${lead}othercommand words` });
      assert.equal(line, 'somecommand !word donated USD 5! othercommand words', JSON.stringify(lead));
    }
    assert.equal(fillChatTemplate('{message}', { message: '!somecommand some text' }), 'somecommand some text');
    assert.equal(fillChatTemplate('{username}{message}', { username: '!', message: '/x' }), 'x');
  });

  test('the start of the line is cleaned too when the template starts with a value', () => {
    assert.equal(fillChatTemplate('  {username}', { username: '\n!x' }), 'x');
    assert.equal(fillChatTemplate('{username} hi', { username: '' }), 'hi');
  });

  test('a template the streamer starts with a command keeps it (their own choice)', () => {
    assert.equal(fillChatTemplate('!so {username}', { username: 'RaidLeader' }), '!so RaidLeader');
    assert.equal(fillChatTemplate('/me {username} joined the pit crew', { username: '/me x' }), '/me me x joined the pit crew');
    assert.equal(fillChatTemplate('!so {username}', { username: '!commands' }), '!so commands', 'the value is still cleaned');
  });

  test('a command word the template leaves to a value is not kept', () => {
    assert.equal(fillChatTemplate('!{message}', { message: 'somecommand x' }), 'somecommand x');
    assert.equal(fillChatTemplate('/{username} hi', { username: 'ban' }), 'ban hi');
    assert.equal(fillChatTemplate('  !so   {username}', { username: 'A' }), '!so   A', 'spaces before the command are fine');
  });

  test('line breaks and other control characters become spaces', () => {
    assert.equal(
      fillChatTemplate(DONATION, { username: 'A\r\nPRIVMSG #other :spam', amount: 'USD 5', message: 'two\nlines\u0000' }),
      'A PRIVMSG #other :spam donated USD 5! two lines'
    );
    assert.equal(fillChatTemplate('Thanks\r\n{username}', { username: 'A' }), 'Thanks A');
  });

  test('names are cut to 50 characters, messages to 300, other values to 50, and the line to 500', () => {
    const line = fillChatTemplate('{username}|{message}|{amount}', { username: 'n'.repeat(80), message: 'm'.repeat(400), amount: '9'.repeat(80) });
    const [name, message, amount] = line.split('|');
    assert.equal(NAME_MAX, 50);
    assert.equal(MESSAGE_MAX, 300);
    assert.equal(name.length, 50);
    assert.equal(message.length, 300);
    assert.equal(amount.length, 50);

    assert.equal(RESULT_MAX, 500);
    const long = fillChatTemplate('x'.repeat(490) + ' {username}', { username: 'abcdefghijklmnop' });
    assert.equal(Array.from(long).length, 500);
  });

  test('maxLength: Infinity leaves the whole line, so a caller can see that it does not fit', () => {
    const template = 'x'.repeat(490) + ' {username}!';
    assert.equal(fillChatTemplate(template, { username: 'abcdefghijklmnop' }, { maxLength: Infinity }).length, 508);
    assert.equal(Array.from(fillChatTemplate(template, { username: 'abcdefghijklmnop' })).length, 500, 'cut to 500 by default');
    // The default cut can end on a space, which trimming then removes: the line
    // is 499 long but has lost its end. Only the whole line shows that.
    const cut = fillChatTemplate('x'.repeat(495) + ' and {username}!', { username: 'LateViewer' });
    assert.equal(cut, 'x'.repeat(495) + ' and');
  });

  test('cutting never splits an emoji in two', () => {
    const name = fillChatTemplate('{username}', { username: '🏎️'.repeat(40) });
    assert.ok(Array.from(name).length <= NAME_MAX);
    assert.ok(!/[\ud800-\udbff]$/.test(name), 'no lone high surrogate at the end');
  });

  test('a list of names reads "A, B and C"', () => {
    const template = 'Welcome to the pit crew, {username}!';
    assert.equal(fillChatTemplate(template, { username: ['A'] }), 'Welcome to the pit crew, A!');
    assert.equal(fillChatTemplate(template, { username: ['A', 'B'] }), 'Welcome to the pit crew, A and B!');
    assert.equal(fillChatTemplate(template, { username: ['A', 'B', 'C'] }), 'Welcome to the pit crew, A, B and C!');
    assert.equal(fillChatTemplate(template, { username: ['!A', '', 'C'] }), 'Welcome to the pit crew, A and C!', 'each name is cleaned; empty ones go');
  });

  test('only the event\'s own values are used, never properties every object has', () => {
    assert.equal(fillChatTemplate('{constructor} {toString} {username}', { username: 'A' }), '{constructor} {toString} A');
  });

  test('no template, no line', () => {
    assert.equal(fillChatTemplate(null, { username: 'A' }), '');
    assert.equal(fillChatTemplate(undefined), '');
    assert.equal(fillChatTemplate('Thanks!'), 'Thanks!');
  });
});

describe('stripCommandPrefix', () => {
  test('removes ! / . \\ and spaces from the start only', () => {
    assert.equal(stripCommandPrefix('!so @someone'), 'so @someone');
    assert.equal(stripCommandPrefix(' / . \\!x!'), 'x!');
    assert.equal(stripCommandPrefix('fine !here'), 'fine !here');
    assert.equal(stripCommandPrefix(''), '');
    assert.equal(stripCommandPrefix(null), '');
  });
});

describe('joinNames', () => {
  test('joins with commas and a final "and"', () => {
    assert.equal(joinNames([]), '');
    assert.equal(joinNames(['A']), 'A');
    assert.equal(joinNames(['A', 'B']), 'A and B');
    assert.equal(joinNames(['A', 'B', 'C', 'D']), 'A, B, C and D');
  });
});

describe('fillChatTemplate: titles, poll winners and games', () => {
  test('{title}, {winner} and {game} keep up to 140 characters (a poll or stream title, tied choices, a category); other values 50', () => {
    const { fillChatTemplate } = require('./chatTemplate');
    assert.equal(fillChatTemplate('{title}', { title: 't'.repeat(200) }), 't'.repeat(140));
    assert.equal(fillChatTemplate('{winner}', { winner: 'w'.repeat(200) }), 'w'.repeat(140));
    assert.equal(fillChatTemplate('{game}', { game: 'g'.repeat(200) }), 'g'.repeat(140));
    assert.equal(fillChatTemplate('{other}', { other: 'o'.repeat(200) }), 'o'.repeat(50));
  });
});
