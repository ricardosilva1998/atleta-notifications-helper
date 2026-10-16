'use strict';

// src/services/alertStyleBundle.js: the family files of the alert looks, joined into one script and
// one stylesheet for the OBS overlay and the Overlay Builder.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { bundle, join } = require('./alertStyleBundle');

const OBJECTS_DIR = path.join(__dirname, '..', '..', 'public', 'overlay', 'objects');
const FAMILY_FILES = (extension) => fs.readdirSync(path.join(OBJECTS_DIR, 'styles')).filter((f) => f.endsWith(extension)).sort();

// A page with the registry and the kit, as the overlay and the builder load them before the joined script.
function page() {
  const window = { console: { log() {}, warn() {}, error() {} } };
  window.window = window;
  const context = vm.createContext(window);
  for (const file of ['index.js', 'kit.js']) vm.runInContext(fs.readFileSync(path.join(OBJECTS_DIR, file), 'utf8'), context, { filename: file });
  return context;
}

test('joins every family file in name order, the script and the stylesheet alike', () => {
  const { css, js } = bundle();
  for (const [text, extension] of [[css, '.css'], [js, '.js']]) {
    const names = [...text.matchAll(/── styles\/([\w-]+\.(?:css|js)) ──/g)].map((m) => m[1]);
    assert.deepEqual(names, FAMILY_FILES(extension));
  }
  for (const file of FAMILY_FILES('.css')) assert.ok(css.includes(fs.readFileSync(path.join(OBJECTS_DIR, 'styles', file), 'utf8')), file);
});

test('the joined script registers every look the family files register', () => {
  const context = page();
  vm.runInContext(bundle().js, context, { filename: 'styles.js' });
  const styles = vm.runInContext('Object.keys(window.ATLETA_OBJECT_STYLES)', context);
  for (const id of ['follow-samurai', 'giveaway-samurai', 'follow-racing', 'giveaway-racing', 'donation-c1']) assert.ok(styles.includes(id), id);
});

test('a family that throws while it registers is left out, and the families after it still register', () => {
  const errors = [];
  const context = page();
  context.console = { error: (...args) => errors.push(args.join(' ')) };
  const broken = { name: 'aaa-broken.js', text: "'use strict';\nthrow new Error('boom');" };
  const racing = { name: 'racing.js', text: fs.readFileSync(path.join(OBJECTS_DIR, 'styles', 'racing.js'), 'utf8') };
  vm.runInContext(join([], [broken, racing]).js, context, { filename: 'styles.js' });
  assert.ok(vm.runInContext("'follow-racing' in window.ATLETA_OBJECT_STYLES", context));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /aaa-broken\.js did not load: boom/);
});

test('each family file keeps its own strict mode', () => {
  const sloppy = { name: 'x.js', text: "'use strict';\nwindow.strictHere = (function () { return this === undefined; })();" };
  const context = page();
  vm.runInContext(join([], [sloppy]).js, context);
  assert.equal(vm.runInContext('window.strictHere', context), true);
});

test('the version is twelve hex characters, the same for the same files and different for others', () => {
  const { version } = bundle();
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.equal(bundle().version, version, 'read once and kept');
  const a = join([{ name: 'a.css', text: '.o-a{}' }], []).version;
  assert.notEqual(join([{ name: 'a.css', text: '.o-a{color:red}' }], []).version, a);
  assert.equal(join([{ name: 'a.css', text: '.o-a{}' }], []).version, a);
});
