#!/usr/bin/env node
'use strict';
// Names one more family in the tests before it is ported: its key at the end of FAMILIES in
// tests/alertStyles.test.js (the gallery's families, in order), and its class and keyframe prefixes in
// tests/alertLooks.test.js (PREFIXES).
// Usage: node family-tests.js <repo> <key> <short prefix>
const fs = require('fs');
const path = require('path');
const [repo, key, short] = process.argv.slice(2);
if (!short) { console.error('usage: family-tests.js <repo> <key> <short>'); process.exit(2); }
const styles = path.join(repo, 'tests', 'alertStyles.test.js');
let s = fs.readFileSync(styles, 'utf8');
const m = /const FAMILIES = \[([^\]]*)\];/.exec(s);
if (!m) throw new Error('no FAMILIES in tests/alertStyles.test.js');
if (m[1].includes("'" + key + "'")) throw new Error(key + ' is already in FAMILIES');
s = s.replace(m[0], 'const FAMILIES = [' + m[1] + ", '" + key + "'];");
fs.writeFileSync(styles, s);
const looks = path.join(repo, 'tests', 'alertLooks.test.js');
let t = fs.readFileSync(looks, 'utf8');
const start = t.indexOf('const PREFIXES = {');
const end = t.indexOf('\n};', start);
if (start < 0 || end < 0) throw new Error('no PREFIXES in tests/alertLooks.test.js');
t = t.slice(0, end) + '\n  ' + key + ": { classes: ['o-" + short + "'], keyframes: ['" + short + "'] }," + t.slice(end);
fs.writeFileSync(looks, t);
console.log(key + ': named in FAMILIES and PREFIXES');
