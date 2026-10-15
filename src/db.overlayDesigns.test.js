'use strict';

// overlay_designs.style: the style an alert is drawn in (andre_vilela_'s donation alert is
// 'donation-c1'), and the save, Reset and one-time switch-on that must keep it. The real
// src/db.js runs on a database file in a temporary folder (never data/bot.db), so a test
// can boot it again on the same file, the way a deploy does.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

// Loads src/db.js on `file`; returns the module and every line it printed.
function boot(file) {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function FileDatabase(_file, opts) { return new RealDatabase(file, opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      // src/config.js exits when the real env vars are missing; db.js only reads the admin ids.
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const lines = [];
  const { log, error } = console;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    delete require.cache[DB_FILE];
    return { db: require(DB_FILE), lines };
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
}

let dir;
let counter = 0;
before(() => { dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'atleta-designs-')); });
after(() => { realFs.rmSync(dir, { recursive: true, force: true }); });
const newFile = () => path.join(dir, `bot-${++counter}.db`);

function addStreamer(sql, over = {}) {
  const n = ++counter;
  return Number(sql.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_user_id, twitch_username) VALUES (?, ?, ?, ?)')
    .run(`2000000000000${String(n).padStart(5, '0')}`, `user${n}`, over.twitch_user_id || `9${String(n).padStart(8, '0')}`, over.twitch_username || `user${n}`)
    .lastInsertRowid);
}

describe('overlay_designs.style', () => {
  let db;
  let sql;
  let streamer;
  before(() => {
    const booted = boot(newFile());
    db = booted.db;
    sql = db.db;
    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), [], 'a first boot prints no migration error');
    streamer = addStreamer(sql);
  });
  after(() => sql.close());
  const row = (eventType = 'donation') => sql.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamer, eventType);

  test('is a column of a fresh database, empty (the alert\'s own look) on a new row', () => {
    assert.ok(sql.pragma('table_info(overlay_designs)').map((c) => c.name).includes('style'));
    db.saveOverlayDesign(streamer, 'follow', {});
    assert.equal(row('follow').style, null);
  });

  test('setOverlayDesignStyle writes the default design when there is none, then the style', () => {
    sql.prepare('DELETE FROM overlay_designs WHERE streamer_id = ?').run(streamer);
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    const saved = row();
    assert.equal(saved.style, 'donation-c1');
    assert.equal(saved.card_width, 420);
    assert.equal(saved.card_position, 'top-center');
    assert.equal(saved.event_label, 'Sponsor Alert', 'the donation\'s own default label');
  });

  test('a save keeps the stored style, and writes everything it is given', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    db.saveOverlayDesign(streamer, 'donation', { card_width: 560, card_position: 'bot-left', card_custom_x: 0.25, card_custom_y: 0.5 });
    const saved = row();
    assert.equal(saved.style, 'donation-c1', 'moving the alert keeps the C1');
    assert.deepEqual([saved.card_width, saved.card_position, saved.card_custom_x, saved.card_custom_y], [560, 'bot-left', 0.25, 0.5]);
    db.saveOverlayDesign(streamer, 'donation', {});
    assert.equal(row().style, 'donation-c1');
    assert.deepEqual([row().card_width, row().card_position, row().card_custom_x], [420, 'top-center', null], 'a value the save leaves out goes back to its default, as before');
  });

  test('a save keeps design_version too (INSERT OR REPLACE used to reset it to 0)', () => {
    db.saveOverlayDesign(streamer, 'donation', {});
    sql.prepare('UPDATE overlay_designs SET design_version = 1 WHERE streamer_id = ? AND event_type = ?').run(streamer, 'donation');
    db.saveOverlayDesign(streamer, 'donation', { card_width: 500 });
    assert.equal(row().design_version, 1);
  });

  test('one row per streamer and alert, updated in place', () => {
    db.saveOverlayDesign(streamer, 'donation', {});
    const id = row().id;
    db.saveOverlayDesign(streamer, 'donation', { card_width: 480 });
    assert.equal(row().id, id, 'the row is updated, not deleted and inserted again');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamer, 'donation').n, 1);
  });

  test('Reset puts a styled design back to the defaults and keeps its style', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    db.saveOverlayDesign(streamer, 'donation', { card_width: 600, bg_color: '#112233' });
    db.resetOverlayDesign(streamer, 'donation');
    const saved = row();
    assert.equal(saved.style, 'donation-c1');
    assert.equal(saved.card_width, 420);
    assert.equal(saved.bg_color, '#110022', 'the donation\'s own card colour');
  });

  test('Reset deletes a design without a style, as before, and does nothing when there is none', () => {
    db.saveOverlayDesign(streamer, 'raid', { card_width: 600 });
    db.resetOverlayDesign(streamer, 'raid');
    assert.equal(row('raid'), undefined);
    db.resetOverlayDesign(streamer, 'bits');
    assert.equal(row('bits'), undefined);
  });

  test('setOverlayDesignStyle(…, null) switches an alert back to its own look', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    db.setOverlayDesignStyle(streamer, 'donation', null);
    assert.equal(row().style, null);
  });

  test('getAllOverlayDesigns hands the style to the overlay with the rest of the row', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    assert.equal(db.getAllOverlayDesigns(streamer).find((d) => d.event_type === 'donation').style, 'donation-c1');
  });
});

describe('a look\'s settings: style_accent, style_label, style_sound, style_grows (alert styles)', () => {
  let db;
  let sql;
  let streamer;
  before(() => {
    const booted = boot(newFile());
    db = booted.db;
    sql = db.db;
    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), [], 'a first boot prints no migration error');
    streamer = addStreamer(sql);
  });
  after(() => sql.close());
  const row = (eventType = 'follow') => sql.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamer, eventType);
  const forget = () => sql.prepare('DELETE FROM overlay_designs WHERE streamer_id = ?').run(streamer);
  const LOOK = { style_accent: '#29E0FF', style_label: 'Quest accepted', style_sound: 'rcFlyby', style_grows: 0 };
  const settings = (r) => Object.fromEntries(Object.keys(LOOK).map((c) => [c, r[c]]));
  const EMPTY = { style_accent: null, style_label: null, style_sound: null, style_grows: null };

  test('are columns of a fresh database, empty (the look\'s own) on a new row', () => {
    const cols = sql.pragma('table_info(overlay_designs)').map((c) => c.name);
    for (const c of Object.keys(LOOK)) assert.ok(cols.includes(c), c);
    db.saveOverlayDesign(streamer, 'follow', {});
    assert.deepEqual(settings(row()), EMPTY);
  });

  test('a second boot on the same file adds nothing and prints no migration error', () => {
    const file = newFile();
    boot(file).db.db.close();
    const again = boot(file);
    assert.deepEqual(again.lines.filter((l) => /\[DB migration\]|Added style_/.test(l)), []);
    again.db.db.close();
  });

  test('a save writes the settings it is given and empties the ones it is not', () => {
    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, card_width: 500 });
    assert.deepEqual(settings(row()), LOOK);
    db.saveOverlayDesign(streamer, 'follow', { card_width: 500 });
    assert.deepEqual(settings(row()), EMPTY);
  });

  test('picking another look starts it from its own settings; where the alert sits and its colours stay', () => {
    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, screen_effect: 'gold', animation_speed: 1.5, card_position: 'bot-left', card_width: 560, bg_color: '#123456' });
    db.setOverlayDesignStyle(streamer, 'follow', 'follow-racing');
    const r = row();
    assert.equal(r.style, 'follow-racing');
    assert.deepEqual(settings(r), EMPTY);
    assert.deepEqual([r.screen_effect, r.animation_speed], ['default', 1]);
    assert.deepEqual([r.card_position, r.card_width, r.bg_color], ['bot-left', 560, '#123456']);
  });

  test('setting the look the alert already has changes nothing', () => {
    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, screen_effect: 'gold' });
    db.setOverlayDesignStyle(streamer, 'follow', 'follow-racing');
    assert.deepEqual(settings(row()), LOOK);
    assert.equal(row().screen_effect, 'gold');
  });

  test('Reset keeps the look and empties its settings', () => {
    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, screen_effect: 'gold' });
    db.resetOverlayDesign(streamer, 'follow');
    assert.equal(row().style, 'follow-racing');
    assert.deepEqual(settings(row()), EMPTY);
    assert.equal(row().screen_effect, 'default');
  });

  test('a row the database writes by itself takes the alert\'s own colours, not the follow alert\'s', () => {
    forget();
    db.setOverlayDesignStyle(streamer, 'raid', 'raid-racing');
    assert.deepEqual([row('raid').bg_color, row('raid').accent_color, row('raid').border_color], ['#1c0505', '#ff4444', '#ff4444']);
    assert.equal(row('raid').event_label, 'Incoming Raid');
  });

  test('setOverlayDesignStyles sets every alert it is given, resetting only the rows whose look changed', () => {
    forget();
    db.setOverlayDesignStyle(streamer, 'follow', 'follow-racing');
    db.saveOverlayDesign(streamer, 'follow', { ...LOOK });
    db.setOverlayDesignStyle(streamer, 'bits', 'bits-samurai');
    db.saveOverlayDesign(streamer, 'bits', { ...LOOK });
    db.setOverlayDesignStyles(streamer, { follow: 'follow-racing', bits: 'bits-racing', raid: 'raid-racing' });
    assert.deepEqual(settings(row('follow')), LOOK, 'follow already had the look: kept');
    assert.equal(row('bits').style, 'bits-racing');
    assert.deepEqual(settings(row('bits')), EMPTY, 'bits changed look: started from its own settings');
    assert.equal(row('raid').style, 'raid-racing', 'a row is made where there was none');
  });

  test('setOverlayDesignStyles is all or nothing', () => {
    forget();
    db.setOverlayDesignStyle(streamer, 'follow', 'follow-samurai');
    sql.exec("CREATE TEMP TRIGGER no_raid BEFORE UPDATE OF style ON overlay_designs WHEN NEW.event_type = 'raid' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    try {
      assert.throws(() => db.setOverlayDesignStyles(streamer, { follow: 'follow-racing', raid: 'raid-racing' }), /boom/);
    } finally {
      sql.exec('DROP TRIGGER no_raid');
    }
    assert.equal(row('follow').style, 'follow-samurai');
    assert.equal(row('raid'), undefined);
  });
});

describe('the one-time switch-on of andre_vilela_\'s C1', () => {
  const ANDRE = '632557806';
  const MIGRATION = 'c1_donation_for_andre_vilela';

  test('a database without him records it as done and changes nothing', () => {
    const booted = boot(newFile());
    const sql = booted.db.db;
    assert.ok(sql.prepare('SELECT 1 FROM data_migrations WHERE name = ?').get(MIGRATION));
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM overlay_designs').get().n, 0);
    assert.ok(!booted.lines.some((l) => l.includes('C1 donation alert')));
    sql.close();
  });

  test('his donation alert becomes the C1 at the next boot, once, and nobody else\'s does', () => {
    const file = newFile();
    // A database from before this release: him, another streamer, and the switch-on not run yet.
    let booted = boot(file);
    let sql = booted.db.db;
    const vilela = addStreamer(sql, { twitch_user_id: ANDRE, twitch_username: 'andre_vilela_' });
    const other = addStreamer(sql);
    booted.db.saveOverlayDesign(other, 'donation', {});
    sql.prepare('DELETE FROM data_migrations WHERE name = ?').run(MIGRATION);
    sql.close();

    booted = boot(file);
    sql = booted.db.db;
    const style = (streamerId) => (sql.prepare('SELECT style FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamerId, 'donation') || {}).style;
    assert.equal(style(vilela), 'donation-c1', 'his donation design was written, with the C1');
    assert.equal(style(other), null);
    assert.equal(booted.lines.filter((l) => l.includes('[DB] The C1 donation alert is on for andre_vilela_')).length, 1);
    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), []);

    // Switched off by hand afterwards: a later boot does not switch it on again.
    booted.db.setOverlayDesignStyle(vilela, 'donation', null);
    sql.close();
    booted = boot(file);
    sql = booted.db.db;
    assert.equal(style(vilela), null);
    sql.close();
  });

  test('a donation design he saved before keeps its position and width, when one boot adds the style column and switches him on (production\'s order)', () => {
    const file = newFile();
    let booted = boot(file);
    let sql = booted.db.db;
    const vilela = addStreamer(sql, { twitch_user_id: ANDRE });
    booted.db.saveOverlayDesign(vilela, 'donation', { card_width: 520, card_position: 'bot-right' });
    // Production's database predates both the column and the switch-on: take them away again, so the next boot
    // does both in one load, the way the deploy will.
    sql.exec('ALTER TABLE overlay_designs DROP COLUMN style');
    assert.ok(!sql.pragma('table_info(overlay_designs)').some((c) => c.name === 'style'), 'the database has no style column');
    sql.prepare('DELETE FROM data_migrations WHERE name = ?').run(MIGRATION);
    sql.close();
    booted = boot(file);
    sql = booted.db.db;
    const saved = sql.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(vilela, 'donation');
    assert.deepEqual([saved.style, saved.card_width, saved.card_position], ['donation-c1', 520, 'bot-right']);
    assert.equal(booted.lines.filter((l) => l.includes('[DB] Added style to overlay_designs')).length, 1);
    assert.equal(booted.lines.filter((l) => l.includes('[DB] The C1 donation alert is on for andre_vilela_')).length, 1);
    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), []);
    sql.close();
  });
});
