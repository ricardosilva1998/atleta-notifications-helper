'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBannedPattern,
  compileBannedWord,
  bannedWordLimitReason,
  limitMessage,
  limitRegexInput,
  MAX_PATTERN_LENGTH,
  MAX_MESSAGE_CHARS,
  MAX_REGEX_INPUT_UNITS,
  MAX_BANNED_WORDS,
  MAX_BANNED_PATTERNS,
} = require('./safePattern');

function rejects(pattern, reason) {
  assert.deepEqual(validateBannedPattern(pattern), { ok: false, reason }, pattern);
}

describe('validateBannedPattern', () => {
  test('accepts ordinary banned-word patterns', () => {
    for (const p of [
      'bad\\s*word',
      'f[o0]o',
      's+p+a+m+', // 4 open-ended repeats: the most allowed
      'b[a@4]+d\\s*w[o0]+rd',
      'colou?r',
      '\\bspam\\b',
      '(?:buy|cheap) followers',
      'bad.*word',
      '(?:abc)+d',
      'h[a@4]ck[e3]r',
      '[o0]{2}ps',
      'x{,3}',
    ]) {
      assert.deepEqual(validateBannedPattern(p), { ok: true }, p);
    }
  });

  test('rejects nested quantifiers', () => {
    for (const p of ['(a+)+$', '(a|a)*', '(.*)*', '(a*)*', '(a|aa)+', '(?:x(?:a+))+', '((a)+)?']) {
      rejects(p, 'nested_quantifier');
    }
  });

  test('rejects backreferences', () => {
    for (const p of ['\\1', '(a)\\1', '(?<w>a)\\k<w>', 'x\\9']) rejects(p, 'backreference');
  });

  test('rejects lookarounds', () => {
    for (const p of ['(?=a)b', '(?!a)b', '(?<=a)b', '(?<!a)b']) rejects(p, 'lookaround');
  });

  test(`rejects patterns longer than ${MAX_PATTERN_LENGTH} characters`, () => {
    assert.equal(MAX_PATTERN_LENGTH, 100);
    rejects('a'.repeat(101), 'too_long');
    assert.deepEqual(validateBannedPattern('a'.repeat(100)), { ok: true });
  });

  test('rejects patterns that do not compile', () => {
    for (const p of ['(', '[a', 'a**', '?', 'a{2,1}', '\\']) rejects(p, 'invalid');
  });

  test('rejects empty and non-string patterns', () => {
    rejects('', 'empty');
    rejects(null, 'empty');
    rejects(42, 'empty');
  });

  test('rejects group syntax it does not analyse (inline modifiers)', () => {
    let modifiersCompile = true;
    try { new RegExp('(?i:a)'); } catch { modifiersCompile = false; }
    rejects('(?i:a)b', modifiersCompile ? 'unsupported' : 'invalid');
  });

  // These have no nested quantifier, yet the engine tries every way of splitting
  // the same characters between the repeats: polynomial time, seconds or more on
  // a 500-character message.
  test('rejects repeated parts that can match the same character', () => {
    for (const p of [
      'a*a*b',
      '\\s*\\s*x',
      'a+a+a+b',
      '.*x.*',
      'a?a?a?aaa',
      '[a-z]+\\w+',
      'a*a{97}b',
      'F+f+',
      '(?:ab)+a+',
      '(?:ab)+b+',
      '\\u00b5+\\u03bc+', // micro sign and Greek mu are equal ignoring case
    ]) {
      rejects(p, 'overlapping_repeats');
    }
  });

  test('accepts repeats that can never match the same character', () => {
    for (const p of ['a+b+', '\\d+[a-z]+', '\\s*\\S', '[^x]*x', 'k+\\u212A+']) {
      assert.deepEqual(validateBannedPattern(p), { ok: true }, p);
    }
  });

  test('rejects chains of choices and repeats that multiply the paths to try', () => {
    rejects('(?:a|a|a|a)(?:a|a|a|a)(?:a|a|a|a)(?:a|a|a|a)(?:a|a)', 'too_complex');
    rejects('a?b?c?d?e?f?g?h?i?', 'too_complex');
    rejects('a{2}b{2}c{2}d{2}e{2}f{2}g{2}h{2}i{2}j{2}k{2}', 'too_complex');
    rejects('s+p+a+m+e+', 'too_complex');
    // A repeat followed by two-way choices: 3 choices is the most allowed.
    assert.deepEqual(validateBannedPattern('.*(?:a|a)(?:a|a)(?:a|a)x'), { ok: true });
    rejects('.*(?:a|a)(?:a|a)(?:a|a)(?:a|a)x', 'too_complex');
    rejects('.*(?:a|a)(?:a|a)(?:a|a)(?:a|a)(?:a|a)x', 'too_complex');
    assert.deepEqual(validateBannedPattern('(?:a|b)(?:c|d)(?:e|f)'), { ok: true });
  });
});

describe('bannedWordLimitReason', () => {
  test(`allows ${MAX_BANNED_WORDS} words per streamer, at most ${MAX_BANNED_PATTERNS} of them regex`, () => {
    assert.equal(MAX_BANNED_WORDS, 100);
    assert.equal(MAX_BANNED_PATTERNS, 20);
    assert.equal(bannedWordLimitReason({ total: 0, regex: 0 }, true), null);
    assert.equal(bannedWordLimitReason({ total: 99, regex: 19 }, true), null, 'the 100th word and 20th pattern fit');
    assert.equal(bannedWordLimitReason({ total: 100, regex: 0 }, false), 'too_many_words');
    assert.equal(bannedWordLimitReason({ total: 100, regex: 20 }, true), 'too_many_words');
    assert.equal(bannedWordLimitReason({ total: 50, regex: 20 }, true), 'too_many_patterns');
    assert.equal(bannedWordLimitReason({ total: 50, regex: 20 }, false), null, 'plain words still fit');
  });
});

describe('compileBannedWord', () => {
  test('a valid regex row gets a case-insensitive regex', () => {
    const { regex } = compileBannedWord('bad\\s*word', true);
    assert.equal(regex.test('this is a BAD   Word here'), true);
    assert.equal(regex.test('this is fine'), false);
  });

  test('plain rows get no regex and match as case-insensitive substrings', () => {
    const { regex, literal } = compileBannedWord('Spoiler', false);
    assert.equal(regex, null);
    assert.equal(literal('no SPOILERS please'), true);
    assert.equal(literal('nothing to see'), false);
    // Regex characters in a plain word are literal text.
    assert.equal(compileBannedWord('a.b', false).literal('axb'), false);
    assert.equal(compileBannedWord('a.b', false).literal('see A.B now'), true);
  });

  test('a regex row also matches its own text literally, for the budget fallback', () => {
    const { regex, literal } = compileBannedWord('sp[a@4]m', true);
    assert.ok(regex);
    assert.equal(literal('the text SP[A@4]M itself'), true);
    assert.equal(literal('sp4m'), false);
  });

  test('a legacy regex row that fails validation gets no regex', () => {
    const { regex, literal } = compileBannedWord('(a+)+$', true);
    assert.equal(regex, null);
    assert.equal(literal('quoting (A+)+$ in chat'), true);
    // As a regex this line would match; as literal text it does not.
    assert.equal(literal('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
  });

  test('an empty word never matches', () => {
    assert.equal(compileBannedWord('', false).literal('anything'), false);
    const empty = compileBannedWord('', true);
    assert.equal(empty.regex, null);
    assert.equal(empty.literal('anything'), false);
  });
});

describe('limitRegexInput', () => {
  test(`keeps only the first ${MAX_REGEX_INPUT_UNITS} UTF-16 code units`, () => {
    assert.equal(MAX_REGEX_INPUT_UNITS, 500);
    assert.equal(limitRegexInput('x'.repeat(600)), 'x'.repeat(500));
    assert.equal(limitRegexInput('short'), 'short');
    // 300 emoji are 600 code units: a regex sees the first 250 emoji.
    assert.equal(limitRegexInput('\u{1F600}'.repeat(300)), '\u{1F600}'.repeat(250));
  });

  test('a surrogate pair split at the boundary is just one more code unit', () => {
    const cut = limitRegexInput('a' + '\u{1F600}'.repeat(300));
    assert.equal(cut.length, 500);
    assert.equal(cut.charCodeAt(499), 0xd83d, 'ends with the first half of an emoji');
    assert.equal(/^a\S+$/i.test(cut), true);
  });
});

describe('limitMessage', () => {
  test(`keeps only the first ${MAX_MESSAGE_CHARS} characters`, () => {
    assert.equal(MAX_MESSAGE_CHARS, 500);
    const long = 'x'.repeat(500) + 'tail';
    assert.equal(limitMessage(long), 'x'.repeat(500));
    assert.equal(limitMessage('short'), 'short');
  });

  test('counts characters, not UTF-16 code units', () => {
    const emoji = '\u{1F600}'.repeat(500);
    assert.equal(limitMessage(emoji + 'tail'), emoji);
  });
});
