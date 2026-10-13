'use strict';

// Twitch channel names as streamers type them: a bare name, "@name", or the
// channel address pasted from the browser. A Twitch login is 1-25 lowercase
// letters, digits and underscores.

const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/;

// The login a typed or pasted value stands for, or null when it cannot be one.
// Anything after the channel name in a pasted address (a sub-page, query or
// fragment) is dropped; spaces inside the name are not repaired, because
// joining the pieces could name a different channel.
function normalizeTwitchLogin(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  value = value.replace(/^(?:https?:\/\/)?(?:(?:www|m|go)\.)?twitch\.tv\//, '');
  value = value.split(/[/?#]/)[0];
  value = value.replace(/^@/, '');
  return LOGIN_PATTERN.test(value) ? value : null;
}

module.exports = { normalizeTwitchLogin, LOGIN_PATTERN };
