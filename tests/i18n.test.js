'use strict';

// The seven locale files in src/locales stay in step with en.json, the source. Checks:
//   1. every language in SUPPORTED_LANGS (src/i18n.js) has a file holding exactly en.json's keys;
//   2. each translation has the same {{placeholders}} as its English text, and the same {chat variables}
//      (the single-brace words the chatbot fills in when it posts);
//   3. no text is empty;
//   4. every key that a view, route or service names, in a t('key') call or as a string in a map of error
//      codes, is in en.json. The few keys built at run time ('lang.' + code) are listed by prefix below,
//      each with the values it can take.
// A failure names the language and the key. When all is in step this file prints nothing.
// How to add a string or a page: docs/features/i18n.md.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SUPPORTED_LANGS } = require('../src/i18n');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const LOCALES = path.join(SRC, 'locales');
const TRANSLATED = SUPPORTED_LANGS.filter((lang) => lang !== 'en');

const loaded = new Map();
function locale(lang) {
  if (!loaded.has(lang)) {
    const file = path.join(LOCALES, `${lang}.json`);
    if (!fs.existsSync(file)) assert.fail(`src/locales/${lang}.json does not exist, but src/i18n.js lists "${lang}" in SUPPORTED_LANGS`);
    try {
      loaded.set(lang, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      assert.fail(`src/locales/${lang}.json is not valid JSON: ${err.message}`);
    }
  }
  return loaded.get(lang);
}

// For the failure messages: a short list on one line, or one line per item (the first 25).
const LIMIT = 25;
const list = (items) => items.slice(0, LIMIT).join(', ') + (items.length > LIMIT ? `, and ${items.length - LIMIT} more` : '');
const lines = (items) => items.slice(0, LIMIT).map((item) => `\n  ${item}`).join('') + (items.length > LIMIT ? `\n  ... and ${items.length - LIMIT} more` : '');

// ── 1. The same keys ─────────────────────────────────────────────────────

describe('every language has exactly the keys of en.json', () => {
  test('en is the source language', () => {
    assert.ok(SUPPORTED_LANGS.includes('en'), 'src/i18n.js must list "en" in SUPPORTED_LANGS: every key is written in en.json first');
  });

  for (const lang of TRANSLATED) {
    test(lang, () => {
      const en = locale('en');
      const translation = locale(lang);
      const missing = Object.keys(en).filter((key) => !Object.hasOwn(translation, key));
      const extra = Object.keys(translation).filter((key) => !Object.hasOwn(en, key));
      if (missing.length || extra.length) {
        assert.fail(`src/locales/${lang}.json is out of step with en.json:`
          + (missing.length ? `\n  ${missing.length} key(s) only en.json has (translate them): ${list(missing)}` : '')
          + (extra.length ? `\n  ${extra.length} key(s) en.json does not have (remove them): ${list(extra)}` : ''));
      }
    });
  }
});

// ── 2. The same placeholders ─────────────────────────────────────────────

// {{name}} is filled in by t(). {name} is a chat-template variable the chatbot fills in when it posts: the
// translation keeps it as it is. A lone brace counts as a token too, so a half-typed {{name} or {name}} fails.
const doubleBraces = (text) => (text.match(/\{\{[^{}]*\}\}/g) || []).sort();
const singleBraces = (text) => (text.replace(/\{\{[^{}]*\}\}/g, '').match(/\{[^{}]*\}|[{}]/g) || []).sort();
const sameTokens = (a, b) => a.length === b.length && a.every((token, i) => token === b[i]);
const show = (tokens) => (tokens.length ? tokens.join(' ') : '(none)');

describe('every translation keeps the placeholders of its English text', () => {
  const kinds = [['{{placeholders}}', doubleBraces], ['{chat variables}', singleBraces]];

  for (const lang of TRANSLATED) {
    test(lang, () => {
      const translation = locale(lang);
      const problems = [];
      for (const [key, english] of Object.entries(locale('en'))) {
        const text = translation[key];
        if (typeof english !== 'string' || typeof text !== 'string') continue; // the key and empty-text checks report those
        for (const [label, tokensOf] of kinds) {
          const want = tokensOf(english);
          const have = tokensOf(text);
          if (!sameTokens(want, have)) problems.push(`${key}: ${label} differ: en.json has ${show(want)}, ${lang}.json has ${show(have)}`);
        }
      }
      if (problems.length) {
        assert.fail(`src/locales/${lang}.json has ${problems.length} text(s) whose placeholders differ from en.json (same names, same number of each):${lines(problems)}`);
      }
    });
  }
});

// ── 3. No empty text ─────────────────────────────────────────────────────

describe('no text is empty', () => {
  for (const lang of SUPPORTED_LANGS) {
    test(lang, () => {
      const empty = Object.entries(locale(lang)).filter(([, text]) => typeof text !== 'string' || text.trim() === '').map(([key]) => key);
      if (empty.length) assert.fail(`src/locales/${lang}.json has ${empty.length} empty or non-text value(s): ${list(empty)}`);
    });
  }
});

// ── 4. The keys the source names ─────────────────────────────────────────

// Keys built at run time: the prefix, and every value the code can put after it. The scan below fails on a
// call that builds a key and is not listed here, so a new one has to say which keys it can produce, and each
// of those is checked against en.json.
const DYNAMIC_KEY_FAMILIES = {
  // views/account.ejs, the language switcher: t('lang.' + code) for each language
  'lang.': SUPPORTED_LANGS,
  // views/guild-config.ejs: t('guild.subRoleProblem.' + reason); the reasons of subRoleEligibility() in services/discordGuards.js
  'guild.subRoleProblem.': ['missing', 'everyone', 'managed', 'privileged', 'above_bot'],
  // routes/dashboard.js: t(`report.analyze.${blocked}`); the reasons of analysisBlockedReason() in services/issueAnalysis.js
  'report.analyze.': ['done', 'analyzing'],
};

// What counts as naming a key:
//  - a call: t('key'), rich('key', ...) or _around('key', name), the ways a view or route asks for a text. The
//    first argument is read up to the first comma or parenthesis, so a choice of two keys
//    (n === 1 ? 'a.b' : 'a.c') is read too; t(lang, 'key') puts a language first;
//  - a string that starts with one of the namespaces of en.json (tip., auth., ...): the keys that routes and
//    services keep in maps of error codes or hand to a helper, as sendText(res, 400, 'auth.error.invalidState')
//    does. A file name such as 'overlay.js' is not one.
// Not followed: a key put together from parts (except the families above), and a first argument with
// parentheses in it.
const CALL = /(?<![\w$])(?:t|rich|_around)\(\s*([^,()]*?)\s*[,)]/g;
const CALL_WITH_LANGUAGE = new RegExp(String.raw`(?<![\w$])t\(\s*(?:['"](?:${SUPPORTED_LANGS.join('|')})['"]|[A-Za-z_$][\w$.]*)\s*,\s*(['"\`])([^'"\`\\\n$]+)\1\s*[,)]`, 'g');
const QUOTED = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const KEY_SHAPED = /(['"`])([A-Za-z]\w*(?:\.\w+)+)\1/g;
const FILE_NAME = /\.(?:js|css|json|ejs|html)$/;

// Every .js and .ejs file under src, except the locale files and the tests (a test names made-up keys on purpose).
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'locales' ? [] : sourceFiles(full);
    return /\.(js|ejs)$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [full] : [];
  }).sort();
}

// { keys: [{ value, where }], prefixes: [{ value, where }] }: the keys the source names (once per file, at the
// first line), and the prefixes of the keys it builds at run time.
function scanSource() {
  const namespaces = new Set(Object.keys(locale('en')).map((key) => key.split('.')[0]));
  const keys = [];
  const prefixes = [];
  for (const file of sourceFiles(SRC)) {
    // an EJS comment is blanked out (line numbers stay right)
    const source = fs.readFileSync(file, 'utf8').replace(/<%#[\s\S]*?%>/g, (comment) => comment.replace(/[^\n]/g, ' '));
    const where = (index) => `${path.relative(ROOT, file)}:${source.slice(0, index).split('\n').length}`;
    const named = new Set();
    const nameKey = (value, index) => {
      if (named.has(value)) return;
      named.add(value);
      keys.push({ value, where: where(index) });
    };

    for (const call of source.matchAll(CALL)) {
      let expression = call[1];
      const choice = expression.search(/\?(?![.?])/); // cond ? 'a.b' : 'a.c': the condition is not a key
      if (choice >= 0) expression = expression.slice(choice + 1);
      for (const literal of expression.matchAll(QUOTED)) {
        const text = literal[1] ?? literal[2] ?? literal[3];
        if (SUPPORTED_LANGS.includes(text)) continue; // t('en', key): the language, not a key
        const rest = expression.slice(literal.index + literal[0].length);
        if (literal[3] !== undefined && text.includes('${')) prefixes.push({ value: text.slice(0, text.indexOf('${')), where: where(call.index) });
        else if (/^\s*\+/.test(rest)) prefixes.push({ value: text, where: where(call.index) });
        else nameKey(text, call.index);
      }
    }
    for (const call of source.matchAll(CALL_WITH_LANGUAGE)) nameKey(call[2], call.index);
    for (const literal of source.matchAll(KEY_SHAPED)) {
      if (namespaces.has(literal[2].split('.')[0]) && !FILE_NAME.test(literal[2])) nameKey(literal[2], literal.index);
    }
  }
  return { keys, prefixes };
}

describe('the keys the source names', () => {
  let scan;
  const scanned = () => { scan = scan || scanSource(); return scan; };

  test('every key a call or a string names is in en.json', () => {
    const en = locale('en');
    const missing = scanned().keys.filter(({ value }) => !Object.hasOwn(en, value));
    if (missing.length) {
      assert.fail(`${missing.length} key(s) named in the source are not in en.json (add each to all seven locale files, or fix the name):${lines(missing.map(({ value, where }) => `${where}  '${value}'`))}`);
    }
  });

  test('a key built at run time is listed with every value it can take', () => {
    const en = locale('en');
    const { prefixes } = scanned();

    const unlisted = prefixes.filter(({ value }) => !Object.hasOwn(DYNAMIC_KEY_FAMILIES, value));
    if (unlisted.length) {
      assert.fail(`${unlisted.length} call(s) build a key at run time that DYNAMIC_KEY_FAMILIES (tests/i18n.test.js) does not list; add the prefix with every value it can take, so those keys are checked too:${lines(unlisted.map(({ value, where }) => `${where}  '${value}' + ...`))}`);
    }
    const unused = Object.keys(DYNAMIC_KEY_FAMILIES).filter((prefix) => !prefixes.some(({ value }) => value === prefix));
    if (unused.length) assert.fail(`DYNAMIC_KEY_FAMILIES lists a prefix that no call builds any more (remove it): ${list(unused)}`);

    const absent = Object.entries(DYNAMIC_KEY_FAMILIES).flatMap(([prefix, values]) => values.map((value) => prefix + value)).filter((key) => !Object.hasOwn(en, key));
    if (absent.length) assert.fail(`${absent.length} key(s) that a run-time key can produce are not in en.json: ${list(absent)}`);
  });

  test('the scan reads the views, the routes and the services', () => {
    for (const dir of ['views', 'routes', 'services']) {
      const seen = scanned().keys.filter(({ where }) => where.startsWith(`src${path.sep}${dir}${path.sep}`)).length;
      assert.ok(seen > 0, `the scan found no key named under src/${dir}: has the way keys are written or the folder changed?`);
    }
  });
});
