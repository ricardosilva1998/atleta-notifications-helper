'use strict';

// Banned-word regexes are written by streamers but are tested against every chat
// message on the single shared event loop. JavaScript's regex engine backtracks,
// so some patterns take seconds to hours on a long line, and while one runs no
// other streamer's overlay, bot or tip page is served. validateBannedPattern()
// only accepts patterns whose worst case stays small on a Twitch-sized message:
//  - at most 100 characters, and the pattern compiles;
//  - no backreferences and no lookarounds;
//  - no repeated group that contains a repeat or a | choice, e.g. (a+)+ or (a|b)*;
//  - no two repeated parts that can match the same character, e.g. a*a*b or
//    \s*.*: the engine would try every way of splitting a run of that character
//    between them, which grows with the line length to the power of the number
//    of such parts;
//  - a bounded number of repeats and | choices, since each one multiplies the
//    paths the engine may try.
// Matching also only looks at the first 500 characters of a message.

const MAX_PATTERN_LENGTH = 100;
const MAX_MESSAGE_CHARS = 500; // Twitch's chat message limit
const MAX_REPEATED_PARTS = 10;
const MAX_BRANCHES = 64;

class Rejection extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function reject(reason) {
  throw new Rejection(reason);
}

// Parses an already-compiled pattern into a tree: { alts: [[node, ...], ...] }.
// A node is { kind: 'unit', src } (matches exactly one UTF-16 code unit: a
// literal, an escape, a class or '.'), { kind: 'assert' } (^ $ \b \B) or
// { kind: 'group', alts }, plus `quant` ({ min, max }) when it is quantified.
function parsePattern(src) {
  let i = 0;

  function disjunction() {
    const alts = [alternative()];
    while (src[i] === '|') {
      i++;
      alts.push(alternative());
    }
    return alts;
  }

  function alternative() {
    const terms = [];
    while (i < src.length && src[i] !== '|' && src[i] !== ')') terms.push(term());
    return terms;
  }

  function term() {
    let node;
    if (src[i] === '^' || src[i] === '$') {
      i++;
      node = { kind: 'assert' };
    } else if (src[i] === '(') {
      node = group();
    } else if (src[i] === '[') {
      node = charClass();
    } else if (src[i] === '\\') {
      node = escape();
    } else {
      node = { kind: 'unit', src: src[i++] };
    }
    node.quant = quantifier();
    return node;
  }

  function group() {
    if (/^\(\?<?[=!]/.test(src.slice(i, i + 4))) reject('lookaround');
    if (src.startsWith('(?:', i)) i += 3;
    else if (src.startsWith('(?<', i)) i = src.indexOf('>', i) + 1; // named group
    else if (src[i + 1] === '?') reject('unsupported'); // inline modifiers and the like
    else i += 1;
    const alts = disjunction();
    i++; // ')'
    return { kind: 'group', alts };
  }

  function charClass() {
    const start = i++;
    if (src[i] === '^') i++;
    // A ']' straight after '[' or '[^' closes an empty class in JavaScript.
    while (i < src.length && src[i] !== ']') i += src[i] === '\\' ? 2 : 1;
    i++;
    return { kind: 'unit', src: src.slice(start, i) };
  }

  function escape() {
    const start = i;
    const next = src[i + 1];
    if (next === 'b' || next === 'B') {
      i += 2;
      return { kind: 'assert' };
    }
    if (/[1-9]/.test(next) || (next === 'k' && src[i + 2] === '<')) reject('backreference');
    if (next === 'c' && !/[a-z]/i.test(src[i + 2] || '')) {
      // "\c" without a control letter is a literal backslash, then a literal "c".
      i += 1;
      return { kind: 'unit', src: '\\\\' };
    }
    const hexDigits = { x: 2, u: 4 }[next];
    const hex = hexDigits ? src.slice(i + 2, i + 2 + hexDigits) : '';
    if (hexDigits && hex.length === hexDigits && /^[0-9a-f]+$/i.test(hex)) {
      i += 2 + hexDigits;
    } else if (next === 'c') {
      i += 3;
    } else if (next === '0') {
      i += 2;
      while (i - start < 4 && /[0-7]/.test(src[i] || '')) i++; // legacy octal, e.g. \012
    } else {
      i += 2;
    }
    return { kind: 'unit', src: src.slice(start, i) };
  }

  function quantifier() {
    let quant = null;
    let length = 1;
    if (src[i] === '*') quant = { min: 0, max: Infinity };
    else if (src[i] === '+') quant = { min: 1, max: Infinity };
    else if (src[i] === '?') quant = { min: 0, max: 1 };
    else if (src[i] === '{') {
      // Anything else after '{' (e.g. "{,3}") is literal text in a non-unicode regex.
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
      if (m) {
        const min = Number(m[1]);
        quant = { min, max: m[2] ? (m[3] ? Number(m[3]) : Infinity) : min };
        length = m[0].length;
      }
    }
    if (!quant) return null;
    i += length;
    if (src[i] === '?') i++; // lazy
    return quant;
  }

  return { alts: disjunction() };
}

function hasRepeatOrChoice(alts) {
  if (alts.length > 1) return true;
  return alts.some((terms) => terms.some(
    (node) => node.quant || (node.kind === 'group' && hasRepeatOrChoice(node.alts))
  ));
}

function unitSources(alts, out = []) {
  for (const terms of alts) {
    for (const node of terms) {
      if (node.kind === 'unit') out.push(node.src);
      else if (node.kind === 'group') unitSources(node.alts, out);
    }
  }
  return out;
}

let everyCodeUnit = null;

// True when one code unit can be matched by one of `a` and by one of `b`, with
// the same case-insensitive rules the banned-word regex uses. Each source
// matches exactly one code unit, so trying all 65,536 of them is exact.
function canMatchSameChar(a, b) {
  if (!a.length || !b.length) return false;
  if (!everyCodeUnit) {
    const chunks = [];
    for (let start = 0; start < 0x10000; start += 0x1000) {
      const codes = [];
      for (let c = start; c < start + 0x1000; c++) codes.push(c);
      chunks.push(String.fromCharCode(...codes));
    }
    everyCodeUnit = chunks.join('');
  }
  return new RegExp(`(?=${a.join('|')})(?:${b.join('|')})`, 'i').test(everyCodeUnit);
}

function checkStructure(tree) {
  const repeated = []; // the code units each repeated part can match
  let branches = 1;

  (function walk(alts) {
    if (alts.length > 1) branches *= alts.length;
    for (const terms of alts) {
      for (const node of terms) {
        const q = node.quant;
        if (q && node.kind === 'group' && hasRepeatOrChoice(node.alts)) reject('nested_quantifier');
        if (q && (q.max > 1 || q.max > q.min)) { // anything but {0} / {1}
          repeated.push(node.kind === 'group' ? unitSources(node.alts) : [node.src]);
          if (q.max > q.min) branches *= 2;
        } else if (node.kind === 'group') {
          walk(node.alts);
        }
      }
    }
  })(tree.alts);

  if (repeated.length > MAX_REPEATED_PARTS || branches > MAX_BRANCHES) reject('too_complex');
  for (let a = 0; a < repeated.length; a++) {
    for (let b = a + 1; b < repeated.length; b++) {
      if (canMatchSameChar(repeated[a], repeated[b])) reject('overlapping_repeats');
    }
  }
}

// Returns { ok: true } or { ok: false, reason }, where reason is one of: empty,
// too_long, invalid, unsupported, backreference, lookaround, nested_quantifier,
// too_complex, overlapping_repeats.
function validateBannedPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return { ok: false, reason: 'empty' };
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, reason: 'too_long' };
  try {
    new RegExp(pattern, 'i');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  try {
    checkStructure(parsePattern(pattern));
  } catch (e) {
    return { ok: false, reason: e instanceof Rejection ? e.reason : 'unsupported' };
  }
  return { ok: true };
}

// Returns text => boolean for one banned_words row. Matching is case-insensitive.
// A regex row that fails validation (saved before validation existed) is matched
// as literal text instead, so it can never run as a regex.
function compileBannedWord(word, isRegex) {
  const text = typeof word === 'string' ? word : '';
  if (isRegex && validateBannedPattern(text).ok) {
    const regex = new RegExp(text, 'i');
    return (message) => regex.test(message);
  }
  const needle = text.toLowerCase();
  if (!needle) return () => false;
  return (message) => message.toLowerCase().includes(needle);
}

// The first MAX_MESSAGE_CHARS characters (code points) of a message.
function limitMessage(message) {
  const text = String(message ?? '');
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  let end = 0;
  for (let chars = 0; chars < MAX_MESSAGE_CHARS && end < text.length; chars++) {
    end += text.codePointAt(end) > 0xffff ? 2 : 1;
  }
  return text.slice(0, end);
}

module.exports = {
  validateBannedPattern,
  compileBannedWord,
  limitMessage,
  MAX_PATTERN_LENGTH,
  MAX_MESSAGE_CHARS,
};
