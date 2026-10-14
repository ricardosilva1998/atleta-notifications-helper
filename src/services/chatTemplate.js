'use strict';

// Fills a streamer's chat template, such as "{username} donated {amount}!
// {message}", with the values of an event for a chat bot to post. The values
// come from viewers (names, donation and sub messages), so:
//  - the template is filled in one pass with a function replacer: "$&", "$'"
//    and the like in a value stay plain text (as a replacement string they
//    repeated the message), and a value that contains "{message}" is not filled
//    in again;
//  - a value never starts with ! / . or \, and neither does the line unless the
//    streamer wrote that command word in the template ("!so {username}",
//    "/me ..."): the bot is a moderator, so a line it posts that starts with
//    another bot's command could run that command;
//  - line breaks and other control characters become spaces;
//  - names are cut to 50 characters, messages to 300, any other value to 50,
//    and the line to 500;
//  - a list of names (thank-yous merged into one line) reads "A, B and C".

const { singleLine } = require('./chatCommands');

const NAME_MAX = 50;
const MESSAGE_MAX = 300;
const OTHER_VALUE_MAX = 50;
const RESULT_MAX = 500;
const VALUE_MAX = Object.freeze({ username: NAME_MAX, message: MESSAGE_MAX });

const PLACEHOLDER = /\{(\w+)\}/g;
const LEADING_COMMAND = /^[\s!/.\\]+/;
const COMMAND_CHARACTER = /^[!/.\\]/;
const HAS_PLACEHOLDER = /\{\w+\}/;

// "!so @someone" -> "so @someone". Only the start changes.
function stripCommandPrefix(text) {
  return String(text ?? '').replace(LEADING_COMMAND, '');
}

// True when the template's first word is a command the streamer wrote out in
// full ("!so {username}"); not when a value would complete it ("!{message}").
function startsWithOwnCommand(template) {
  const firstWord = template.trimStart().split(/\s/, 1)[0];
  return COMMAND_CHARACTER.test(firstWord) && !HAS_PLACEHOLDER.test(firstWord);
}

// The first `max` characters (code points), so an emoji is never cut in two.
function limitCharacters(text, max) {
  const characters = Array.from(text);
  return characters.length <= max ? text : characters.slice(0, max).join('');
}

function cleanValue(value, max) {
  return limitCharacters(stripCommandPrefix(singleLine(value ?? '')), max).trim();
}

// ["A", "B", "C"] -> "A, B and C".
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// `values` maps placeholder names to text or numbers; a list is joined as names.
// Placeholders without a value stay as they are. Returns '' without a template.
function fillChatTemplate(template, values = {}) {
  if (typeof template !== 'string') return '';
  const filled = template.replace(PLACEHOLDER, (placeholder, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return placeholder;
    const max = VALUE_MAX[key] || OTHER_VALUE_MAX;
    const value = values[key];
    if (Array.isArray(value)) return joinNames(value.map((v) => cleanValue(v, max)).filter(Boolean));
    return cleanValue(value, max);
  });
  let line = singleLine(filled);
  if (!startsWithOwnCommand(template)) line = stripCommandPrefix(line);
  return limitCharacters(line, RESULT_MAX).trim();
}

module.exports = {
  fillChatTemplate,
  stripCommandPrefix,
  joinNames,
  NAME_MAX,
  MESSAGE_MAX,
  OTHER_VALUE_MAX,
  RESULT_MAX,
};
