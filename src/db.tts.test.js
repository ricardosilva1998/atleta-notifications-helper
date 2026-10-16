'use strict';

// The storage behind reading tips aloud in src/db.js, against the real file on an in-memory SQLite database (nothing
// touches data/bot.db): the streamers columns, the monthly usage that characters are reserved from, the per-tip
// status and the removal of a streamer's usage rows. All ids are synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let counter = 0;

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
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

function addStreamer() {
  const n = ++counter;
  return Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username) VALUES (?, ?)')
    .run(`72000000000000${String(n).padStart(4, '0')}`, `tts${n}`).lastInsertRowid);
}
const columns = (table) => new Map(db.db.pragma(`table_info(${table})`).map((c) => [c.name, c]));

describe('the storage', () => {
  test('a fresh database has every column named above, the usage table and the status column', () => {
    const streamers = columns('streamers');
    for (const name of ['tts_enabled', 'tts_min_amount', 'tts_language', 'tts_voice', 'tts_speed', 'tts_expressiveness',
      'tts_volume', 'tts_template', 'tts_template_empty', 'tts_monthly_limit', 'tts_last_error', 'tts_last_error_at']) {
      assert.ok(streamers.has(name), `streamers.${name}`);
    }
    assert.ok(columns('donations').has('tts_status'));
    const usage = columns('tts_usage');
    assert.deepEqual([...usage.keys()], ['streamer_id', 'month', 'characters']);
    assert.equal(usage.get('characters').notnull, 1);
    assert.equal(usage.get('characters').dflt_value, '0');
  });

  test('a new streamer starts with the reading off and the defaults', () => {
    const s = db.getStreamerById(addStreamer());
    assert.equal(s.tts_enabled, 0);
    assert.equal(s.tts_min_amount, 5);
    assert.equal(s.tts_speed, 1);
    assert.equal(s.tts_expressiveness, 0.5);
    assert.equal(s.tts_volume, 0.8);
    assert.equal(s.tts_language, null);
    assert.equal(s.tts_monthly_limit, null);
  });
});

describe('the monthly usage', () => {
  test('reserving stops at the limit and never cuts', () => {
    const id = addStreamer();
    assert.equal(db.reserveTtsCharacters(id, '2026-10', 14000, 15000), true);
    assert.equal(db.reserveTtsCharacters(id, '2026-10', 1200, 15000), false);
    assert.equal(db.getTtsUsage(id, '2026-10'), 14000);
    assert.equal(db.reserveTtsCharacters(id, '2026-10', 1000, 15000), true);
    assert.equal(db.getTtsUsage(id, '2026-10'), 15000);
    assert.equal(db.getTtsUsage(id, '2026-11'), 0);
  });

  test('a refused reservation on a new month leaves no row, and months and streamers count apart', () => {
    const a = addStreamer();
    const b = addStreamer();
    assert.equal(db.reserveTtsCharacters(a, '2026-10', 20000, 15000), false);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tts_usage WHERE streamer_id = ?').get(a).n, 0);
    assert.equal(db.reserveTtsCharacters(a, '2026-10', 100, 15000), true);
    assert.equal(db.reserveTtsCharacters(b, '2026-10', 200, 15000), true);
    assert.equal(db.reserveTtsCharacters(a, '2026-11', 300, 15000), true);
    assert.equal(db.getTtsUsage(a, '2026-10'), 100);
    assert.equal(db.getTtsUsage(b, '2026-10'), 200);
    assert.equal(db.getTtsUsage(a, '2026-11'), 300);
  });

  test('removing a streamer removes their usage rows', () => {
    const id = addStreamer();
    db.reserveTtsCharacters(id, '2026-10', 10, 15000);
    assert.equal(db.deleteStreamer(id), true);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tts_usage WHERE streamer_id = ?').get(id).n, 0);
  });
});

describe('the settings writers', () => {
  test('updateTtsSettings writes the settings it is given and nothing else', () => {
    const id = addStreamer();
    db.updateTtsSettings(id, {
      tts_enabled: 1, tts_min_amount: 7.5, tts_language: 'pt', tts_voice: 'v1', tts_speed: 1.1,
      tts_expressiveness: 0.2, tts_volume: 0.6, tts_template: 'Hi {name}', tts_template_empty: null,
      tts_monthly_limit: 99999, display_name: 'x',
    });
    const s = db.getStreamerById(id);
    assert.equal(s.tts_enabled, 1);
    assert.equal(s.tts_min_amount, 7.5);
    assert.equal(s.tts_language, 'pt');
    assert.equal(s.tts_voice, 'v1');
    assert.equal(s.tts_speed, 1.1);
    assert.equal(s.tts_expressiveness, 0.2);
    assert.equal(s.tts_volume, 0.6);
    assert.equal(s.tts_template, 'Hi {name}');
    assert.equal(s.tts_template_empty, null);
    assert.equal(s.tts_monthly_limit, null);
  });

  test('setTtsMonthlyLimit stores a limit and an empty one clears it', () => {
    const id = addStreamer();
    db.setTtsMonthlyLimit(id, 40000);
    assert.equal(db.getStreamerById(id).tts_monthly_limit, 40000);
    db.setTtsMonthlyLimit(id, null);
    assert.equal(db.getStreamerById(id).tts_monthly_limit, null);
  });

  test('recordTtsError keeps 200 characters and the time', () => {
    const id = addStreamer();
    db.recordTtsError(id, 'x'.repeat(300));
    const s = db.getStreamerById(id);
    assert.equal(s.tts_last_error.length, 200);
    assert.match(s.tts_last_error_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });

  test('clearTtsError empties the last problem and its time, for that streamer only', () => {
    const id = addStreamer();
    const other = addStreamer();
    db.recordTtsError(id, 'elevenlabs_401');
    db.recordTtsError(other, 'elevenlabs_500');
    db.clearTtsError(id);
    const cleared = db.getStreamerById(id);
    assert.equal(cleared.tts_last_error, null);
    assert.equal(cleared.tts_last_error_at, null);
    assert.equal(db.getStreamerById(other).tts_last_error, 'elevenlabs_500');
  });
});

describe('the per-tip status', () => {
  test('a donation row takes its TTS status by source and external id', () => {
    const id = addStreamer();
    assert.equal(db.logDonation(id, { source: 'paypal', amount: 10, currency: 'USD', external_id: 'ORDER1' }), true);
    const row = () => db.db.prepare("SELECT tts_status FROM donations WHERE source = 'paypal' AND external_id = 'ORDER1'").get();
    assert.equal(row().tts_status, null);
    db.setDonationTtsStatus('paypal', 'ORDER1', 'read');
    assert.equal(row().tts_status, 'read');
  });
});
