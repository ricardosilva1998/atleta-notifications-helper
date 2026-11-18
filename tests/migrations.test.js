'use strict';

// A database made by the oldest src/db.js in git history (tests/fixtures/schema-oldest.sql, schema only) is
// opened by today's db.js; every table must end up with the same columns as on a fresh database. This is what
// production is: an old file that went through every migration, which a fresh-database test never exercises.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, '..', 'src', 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');
const FIXTURE = realFs.readFileSync(path.join(__dirname, 'fixtures', 'schema-oldest.sql'), 'utf8');

// Known difference, on purpose: `sessions` is not rebuilt (production's has a nullable streamer_id and a
// racing_user_id column that old databases keep), so only its columns are compared as a subset.
const NOT_REBUILT = new Set(['sessions']);

function boot(seed) {
  const origLoad = Module._load.bind(Module);
  let inst;
  const errors = [];
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') {
        return function MemoryDatabase(_file, opts) {
          inst = Buffer.isBuffer(seed) ? new RealDatabase(seed, opts) : new RealDatabase(':memory:', opts);
          if (typeof seed === 'string') inst.exec(seed);
          return inst;
        };
      }
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    delete require.cache[DB_FILE];
    require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
    delete require.cache[DB_FILE];
  }
  return { raw: inst, errors };
}

function columns(raw) {
  const out = {};
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) {
    out[name] = {};
    for (const c of raw.pragma(`table_info(${name})`)) {
      out[name][c.name] = `${c.type}|notnull=${c.notnull}|default=${c.dflt_value}|pk=${c.pk}`;
    }
  }
  return out;
}

test('a database from the oldest schema ends with the same columns as a fresh one', () => {
  const fresh = boot(null);
  const old = boot(FIXTURE);
  assert.deepEqual(old.errors.filter((m) => /\[DB migration\]/.test(m)), [], 'migration errors on the old database');
  const a = columns(fresh.raw);
  const b = columns(old.raw);
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), 'the same tables');
  for (const table of Object.keys(a)) {
    if (NOT_REBUILT.has(table)) {
      for (const col of Object.keys(a[table])) assert.ok(col in b[table], `${table}.${col} is missing on the migrated database`);
      continue;
    }
    const missing = Object.keys(a[table]).filter((c) => !(c in b[table]));
    assert.deepEqual(missing, [], `${table}: columns a migrated database lacks`);
    const extra = Object.keys(b[table]).filter((c) => !(c in a[table]));
    assert.deepEqual(extra, [], `${table}: columns only a migrated database has`);
  }
});

test('booting over an already migrated database changes no column and logs no migration line', () => {
  const first = boot(FIXTURE);
  const before = columns(first.raw);
  const second = boot(first.raw.serialize());
  assert.deepEqual(second.errors.filter((m) => /\[DB migration\]/.test(m)), []);
  assert.deepEqual(columns(second.raw), before);
});
