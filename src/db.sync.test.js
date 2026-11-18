'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;

before(() => {
  const origLoad = Module._load.bind(Module);
  let first = true;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      // The first open is the live database (in memory); scrubSnapshot's own open is a real file.
      if (request === 'better-sqlite3') {
        return function Db(file, opts) {
          if (first) { first = false; return new RealDatabase(':memory:', opts); }
          return new RealDatabase(file, opts);
        };
      }
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
});

function makeSnapshot(file) {
  const d = new RealDatabase(file);
  d.exec(`
    CREATE TABLE streamers (id INTEGER PRIMARY KEY, paypal_email TEXT, overlay_token TEXT, multistream_token TEXT, bot_access_token TEXT);
    CREATE TABLE coaching_payments (order_id TEXT PRIMARY KEY, payee_email TEXT NOT NULL, payer_name TEXT, payer_email TEXT, payer_id TEXT);
    CREATE TABLE coaching_bookings (id INTEGER PRIMARY KEY, viewer_discord_id TEXT NOT NULL, viewer_username TEXT NOT NULL, viewer_display_name TEXT, viewer_avatar TEXT, note TEXT);
    CREATE TABLE viewer_sessions (sid TEXT PRIMARY KEY, discord_user_id TEXT);
    CREATE TABLE pending_tips (order_id TEXT PRIMARY KEY, donor_name TEXT NOT NULL, message TEXT, payee_email TEXT);
    INSERT INTO streamers VALUES (1, 'coach@pay.example', 'orig-overlay-token', 'orig-ms-token', 'enc:v1:abc');
    INSERT INTO streamers VALUES (2, NULL, NULL, NULL, NULL);
    INSERT INTO coaching_payments VALUES ('O1', 'coach@pay.example', 'Payer Name', 'payer@mail.example', 'PAYERID');
    INSERT INTO coaching_bookings VALUES (7, '123456789', 'realviewer', 'Real Viewer', 'https://a/x.png', 'private note');
    INSERT INTO viewer_sessions VALUES ('s1', '123456789');
    INSERT INTO pending_tips VALUES ('O2', 'Donor', 'hello', 'coach@pay.example');
  `);
  d.close();
}

describe('scrubSnapshot', () => {
  test('removes personal data and live tokens from the copy only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
    try {
      const source = path.join(dir, 'source.db');
      const copy = path.join(dir, 'copy.db');
      makeSnapshot(source);
      fs.copyFileSync(source, copy);

      db.scrubSnapshot(copy);

      const c = new RealDatabase(copy, { readonly: true });
      const dump = JSON.stringify([
        c.prepare('SELECT * FROM streamers').all(),
        c.prepare('SELECT * FROM coaching_payments').all(),
        c.prepare('SELECT * FROM coaching_bookings').all(),
        c.prepare('SELECT * FROM viewer_sessions').all(),
        c.prepare('SELECT * FROM pending_tips').all(),
      ]);
      for (const secret of ['coach@pay.example', 'payer@mail.example', 'Payer Name', 'PAYERID', 'orig-overlay-token',
        'orig-ms-token', '123456789', 'realviewer', 'Real Viewer', 'private note', 'hello', 'Donor']) {
        assert.ok(!dump.includes(secret), `${secret} must be gone`);
      }
      const s1 = c.prepare('SELECT * FROM streamers WHERE id = 1').get();
      assert.ok(s1.overlay_token && s1.multistream_token);
      assert.equal(s1.bot_access_token, 'enc:v1:abc');
      assert.equal(c.prepare('SELECT overlay_token FROM streamers WHERE id = 2').get().overlay_token, null);
      c.close();

      const o = new RealDatabase(source, { readonly: true });
      assert.equal(o.prepare('SELECT overlay_token FROM streamers WHERE id = 1').get().overlay_token, 'orig-overlay-token');
      assert.equal(o.prepare('SELECT payer_email FROM coaching_payments').get().payer_email, 'payer@mail.example');
      o.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an older schema without some tables is scrubbed as far as it goes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
    try {
      const f = path.join(dir, 'old.db');
      const d = new RealDatabase(f);
      d.exec("CREATE TABLE streamers (id INTEGER PRIMARY KEY, paypal_email TEXT); INSERT INTO streamers VALUES (1, 'x@y.z')");
      d.close();
      db.scrubSnapshot(f);
      const c = new RealDatabase(f, { readonly: true });
      assert.equal(c.prepare('SELECT paypal_email FROM streamers').get().paypal_email, null);
      c.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
