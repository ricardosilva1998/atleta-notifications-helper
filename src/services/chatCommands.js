'use strict';

// The rules for a streamer's custom chat commands, used by the add and the
// update route alike (the update route used to skip them: a blank name answered
// every lone "!", and a missing response or a name already in use was a 500).

const { clampInt } = require('./inputLimits');

const COMMAND_NAME_MAX = 50;
// A Twitch chat message is at most 500 characters.
const COMMAND_RESPONSE_MAX = 500;
const COMMAND_COOLDOWN_SECONDS = Object.freeze({ min: 5, max: 3600, fallback: 5 });

// Error codes of parseCommand() and the routes -> locale keys. The page turns a
// code from the URL into text only if it is one of these.
const COMMAND_ERRORS = {
  name_invalid: 'chatbot.commands.error.nameInvalid',
  response_required: 'chatbot.commands.error.responseRequired',
  response_too_long: 'chatbot.commands.error.responseTooLong',
  duplicate: 'chatbot.commands.error.duplicate',
};

// Chat is one line. tmi.js sends the text as it is, so a line break inside it
// would send the rest as further IRC lines from the shared bot.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]+/g;
function singleLine(text) {
  return String(text).replace(CONTROL_CHARACTERS, ' ').trim();
}

// "!Socials " -> "socials". Anything but letters, digits and underscores, or an
// empty or over-long name, is null.
function normalizeCommandName(raw) {
  if (typeof raw !== 'string') return null;
  let name = raw.trim();
  if (name.startsWith('!')) name = name.slice(1).trim();
  name = name.toLowerCase();
  return /^[a-z0-9_]+$/.test(name) && name.length <= COMMAND_NAME_MAX ? name : null;
}

// The command fields of a form body: { command, response, cooldown }, or
// { error } with a COMMAND_ERRORS code.
function parseCommand(body) {
  const input = body || {};
  const command = normalizeCommandName(input.command);
  if (!command) return { error: 'name_invalid' };

  const response = typeof input.response === 'string' ? singleLine(input.response) : '';
  if (!response) return { error: 'response_required' };
  if (response.length > COMMAND_RESPONSE_MAX) return { error: 'response_too_long' };

  const { min, max, fallback } = COMMAND_COOLDOWN_SECONDS;
  return { command, response, cooldown: clampInt(input.cooldown, min, max, fallback) };
}

// better-sqlite3 error for a (streamer_id, command) that already exists.
function isUniqueViolation(err) {
  return !!err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

module.exports = {
  COMMAND_NAME_MAX,
  COMMAND_RESPONSE_MAX,
  COMMAND_COOLDOWN_SECONDS,
  COMMAND_ERRORS,
  singleLine,
  normalizeCommandName,
  parseCommand,
  isUniqueViolation,
};
