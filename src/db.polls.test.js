'use strict';

// The Polls & predictions and Shoutouts data in src/db.js, against the real file on an in-memory SQLite database
// (nothing touches data/bot.db): the new streamers columns and their defaults, the poll templates (a streamer's own
// only), and the two settings writers. All ids are synthetic.

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
    .run(`71000000000000${String(n).padStart(4, '0')}`, `polls${n}`).lastInsertRowid);
}
const value = (over = {}) => ({ kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, ...over });

describe('the new streamers columns', () => {
  test('a new streamer starts with the announcements on, the shoutouts off and the default texts', () => {
    const s = db.getStreamerById(addStreamer());
    assert.equal(s.polls_chat_enabled, 1);
    assert.equal(s.shoutout_command_enabled, 0);
    assert.equal(s.shoutout_raid_enabled, 0);
    assert.equal(s.shoutout_raid_min_viewers, 1);
    assert.equal(s.poll_start_template, 'Poll: {title} — vote now! ({time} to vote)');
    assert.equal(s.poll_end_template, 'Poll closed: {winner} won with {percent}% of the votes.');
    assert.equal(s.prediction_start_template, 'Prediction: {title} — place your channel points! ({time} to predict)');
    assert.equal(s.prediction_lock_template, 'Predictions are locked for "{title}". Good luck!');
    assert.equal(s.prediction_end_template, '{outcome} wins! {winners} viewers share {points} channel points.');
    assert.equal(s.prediction_cancel_template, 'Prediction cancelled: "{title}". Everyone gets their channel points back.');
    assert.equal(s.shoutout_template, 'Go check out {name}! They were last streaming {game}: {link}');
  });
});

describe('poll templates', () => {
  test('added, read back in order, changed and deleted — a streamer\'s own only', () => {
    const a = addStreamer();
    const b = addStreamer();
    const first = db.addPollTemplate(a, value());
    const second = db.addPollTemplate(a, value({ kind: 'prediction', title: 'Clean lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60 }));
    assert.deepEqual(first, { id: first.id, kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1 });
    assert.equal(second.sortOrder, 2);
    assert.deepEqual(db.getPollTemplates(a).map((t) => t.title), ['Top 5?', 'Clean lap?']);
    assert.equal(db.countPollTemplates(a), 2);
    assert.deepEqual(db.getPollTemplates(b), []);
    assert.equal(db.getPollTemplate(first.id, b), null, 'another streamer\'s template is not found');
    assert.equal(db.getPollTemplate(null, a), null);

    assert.equal(db.updatePollTemplate(first.id, b, value({ title: 'Hijack' })), false);
    assert.equal(db.getPollTemplate(first.id, a).title, 'Top 5?');
    assert.equal(db.updatePollTemplate(first.id, a, value({ title: 'Podium?', pointsPerVote: 50 })), true);
    assert.deepEqual(db.getPollTemplate(first.id, a), { ...first, title: 'Podium?', pointsPerVote: 50 });

    assert.equal(db.deletePollTemplate(first.id, b), false);
    assert.equal(db.deletePollTemplate(first.id, a), true);
    assert.equal(db.deletePollTemplate(first.id, a), false, 'already gone');
    assert.equal(db.countPollTemplates(a), 1);
  });

  test('choices keep their order and characters; a row whose choices cannot be read has none', () => {
    const a = addStreamer();
    const t = db.addPollTemplate(a, value({ choices: ['🏁 Yes "really"', 'No, <b>never</b>', 'Maybe'] }));
    assert.deepEqual(db.getPollTemplate(t.id, a).choices, ['🏁 Yes "really"', 'No, <b>never</b>', 'Maybe']);
    db.db.prepare('UPDATE poll_templates SET choices = ? WHERE id = ?').run('not json', t.id);
    assert.deepEqual(db.getPollTemplate(t.id, a).choices, []);
  });

  test('removing an account removes its templates', () => {
    const a = addStreamer();
    db.addPollTemplate(a, value());
    db.deleteStreamer(a);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM poll_templates WHERE streamer_id = ?').get(a).n, 0);
  });
});

describe('the settings writers', () => {
  test('each writes only its own columns', () => {
    const a = addStreamer();
    const before = db.getStreamerById(a);
    db.updatePollSettings(a, { polls_chat_enabled: 0, poll_start_template: 'Vote: {title}', chatbot_enabled: 1, shoutout_raid_enabled: 1 });
    db.updateShoutoutSettings(a, { shoutout_raid_enabled: 1, shoutout_raid_min_viewers: 5, shoutout_template: 'SO {name}', overlay_enabled: 1, polls_chat_enabled: 1 });
    const s = db.getStreamerById(a);
    assert.equal(s.polls_chat_enabled, 0, 'the shoutouts writer does not write the polls switch');
    assert.equal(s.poll_start_template, 'Vote: {title}');
    assert.equal(s.shoutout_raid_enabled, 1);
    assert.equal(s.shoutout_raid_min_viewers, 5);
    assert.equal(s.shoutout_template, 'SO {name}');
    assert.equal(s.chatbot_enabled, before.chatbot_enabled, 'a column of another card is left alone');
    assert.equal(s.overlay_enabled, before.overlay_enabled);
  });
});
