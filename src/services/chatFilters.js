'use strict';

// Pure text checks behind the chat moderation filters (Twitch and YouTube).

// Real top-level domains seen in chat links. A bare "word.word" only counts as a
// link when it ends in one of these, so typos such as "ok.so", "e.g." or "3.5"
// are not links.
const LINK_TLDS = [
  'com', 'net', 'org', 'io', 'gg', 'tv', 'me', 'co', 'uk', 'de', 'fr', 'es', 'pt',
  'br', 'it', 'nl', 'ru', 'jp', 'cn', 'xyz', 'app', 'dev', 'ly', 'be', 'link',
  'info', 'live',
];

const LINK_PATTERN = new RegExp(
  [
    '\\b[a-z][a-z0-9+.-]{0,30}:\\/\\/\\S', // a scheme: https://, ftp://, ...
    '\\bwww\\.[a-z0-9-]', // www.host (but not "awww...")
    // host.tld, starting at the beginning of the host so each run is scanned once
    `(?<![a-z0-9-])[a-z0-9-]+\\.(?:${LINK_TLDS.join('|')})(?![a-z0-9-])`,
  ].join('|'),
  'i'
);

function containsLink(text) {
  return LINK_PATTERN.test(text);
}

// Only ASCII punctuation and symbols count. Letters and numbers of any script,
// and emoji, never do, so a message in Japanese or Arabic is not "symbol spam".
const ASCII_SYMBOLS = /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g;

// Percentage of ASCII symbols among the message's characters; null for
// messages shorter than 5 characters.
function symbolPercent(text) {
  const length = Array.from(text).length;
  if (length < 5) return null;
  const symbols = (text.match(ASCII_SYMBOLS) || []).length;
  return Math.round((symbols / length) * 100);
}

const MIN_CAPS_LETTERS = 8;

// tmi.js emotes tag: { emoteId: ['start-end', ...] }, inclusive positions counted
// in characters (code points) of the message.
function emoteRanges(emotes) {
  const ranges = [];
  if (!emotes || typeof emotes !== 'object') return ranges;
  for (const positions of Object.values(emotes)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      const m = /^(\d+)-(\d+)$/.exec(position);
      if (m) ranges.push([Number(m[1]), Number(m[2])]);
    }
  }
  return ranges;
}

// Percentage of upper-case letters among the letters that have case, ignoring
// Twitch emotes (names like LUL or PogChamp are written in capitals). Null when
// fewer than 8 such letters remain: a short message cannot be shouting.
function capsPercent(text, emotes) {
  const chars = Array.from(text);
  for (const [start, end] of emoteRanges(emotes)) {
    for (let k = start; k <= end && k < chars.length; k++) chars[k] = ' ';
  }
  const rest = chars.join('');
  const upper = (rest.match(/\p{Lu}/gu) || []).length;
  const lower = (rest.match(/\p{Ll}/gu) || []).length;
  if (upper + lower < MIN_CAPS_LETTERS) return null;
  return Math.round((upper / (upper + lower)) * 100);
}

module.exports = { containsLink, symbolPercent, capsPercent, LINK_TLDS, MIN_CAPS_LETTERS };
