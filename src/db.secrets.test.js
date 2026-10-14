'use strict';

// Secrets at rest in src/db.js: the OAuth tokens and the StreamElements token
// (encrypted with TOKEN_ENCRYPTION_KEY when it is set) and the web session ids
// (stored hashed). The real db.js is booted several times against temporary
// database files, with and without a key, as successive deploys would boot it.
// Nothing touches data/bot.db. All ids, tokens and keys are synthetic.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const RealDatabase = require('better-sqlite3');
const secretBox = require('./services/secretBox');

const DB_FILE = path.join(__dirname, 'db.js');
const KEY = '0123456789abcdef'.repeat(4);
const OTHER_KEY = 'fedcba9876543210'.repeat(4);

const TOKEN_COLUMNS = [
  'broadcaster_access_token', 'broadcaster_refresh_token',
  'yt_access_token', 'yt_refresh_token',
  'spotify_access_token', 'spotify_refresh_token',
  'bot_access_token', 'bot_refresh_token',
  'streamelements_jwt',
];

let tmpDir;
let fileCount = 0;
before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-secrets-')); });
after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const newFile = () => path.join(tmpDir, `boot-${++fileCount}.db`);

// One boot of src/db.js on `file` (with TOKEN_ENCRYPTION_KEY = key, or none):
// `inspect` gets the module, then it is closed. Returns what it logged.
function boot(file, { key = null, inspect } = {}) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function FileDatabase(_file, opts) { return new RealDatabase(file, opts); };
      if (request === 'fs') return { ...fs, existsSync: () => true, mkdirSync: () => {} };
      // src/config.js exits when the real env vars are missing; db.js reads these two.
      if (request === './config') return { adminDiscordIds: [], tokenEncryption: { key: key || '' } };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  for (const level of ['log', 'warn', 'error']) console[level] = (...args) => logs.push([level, args.join(' ')]);
  let mod;
  try {
    delete require.cache[DB_FILE];
    mod = require(DB_FILE);
    if (inspect) inspect(mod);
  } finally {
    Object.assign(console, saved);
    Module._load = origLoad;
    delete require.cache[DB_FILE];
    if (mod) mod.db.close();
  }
  return logs;
}

// A database with production's columns (a new file has them all after its first boot).
function preparedFile() {
  const file = newFile();
  boot(file);
  return file;
}

function raw(file, fn) {
  const handle = new RealDatabase(file);
  try { return fn(handle); } finally { handle.close(); }
}

let counter = 0;
function insertStreamer(handle, over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `40000000000000${String(n).padStart(4, '0')}`, discord_username: `streamer${n}`, ...over };
  const names = Object.keys(cols);
  return Number(handle.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((k) => cols[k])).lastInsertRowid);
}
const rawTokens = (file, id) => raw(file, (h) => h.prepare(`SELECT ${TOKEN_COLUMNS.join(', ')} FROM streamers WHERE id = ?`).get(id));
const plainTokens = (tag) => Object.fromEntries(TOKEN_COLUMNS.map((c) => [c, `${tag}-${c}`]));

// Writes every token column through db.js's own writers.
function writeAllTokens(db, id, tag) {
  const t = plainTokens(tag);
  db.updateStreamerBroadcasterTokens(id, t.broadcaster_access_token, t.broadcaster_refresh_token, Date.now() + 3_600_000);
  db.updateStreamerYoutubeTokens(id, t.yt_access_token, t.yt_refresh_token, Date.now() + 3_600_000, 'Synthetic Channel');
  db.updateSpotifyTokens(id, t.spotify_access_token, t.spotify_refresh_token, Date.now() + 3_600_000);
  db.updateBotTokens(id, t.bot_access_token, t.bot_refresh_token, Date.now() + 3_600_000, 'synthetic_bot');
  db.updateOverlayConfig(id, { streamelements_jwt: t.streamelements_jwt, overlay_enabled: 1 });
  return t;
}

const tokensOf = (row) => Object.fromEntries(TOKEN_COLUMNS.filter((c) => c in row).map((c) => [c, row[c]]));

// ── Tokens ───────────────────────────────────────────────────────────────

describe('tokens without TOKEN_ENCRYPTION_KEY', () => {
  test('are stored and read as before, in plain text, and nothing is reported at boot', () => {
    const file = preparedFile();
    let id;
    let written;
    const logs = boot(file, {
      inspect: (db) => {
        assert.equal(db.tokenEncryptionEnabled, false);
        id = insertStreamer(db.db);
        written = writeAllTokens(db, id, 'plain');
        assert.deepEqual(tokensOf(db.getStreamerById(id)), written);
      },
    });
    assert.deepEqual(rawTokens(file, id), written, 'stored as given');
    assert.deepEqual(logs.filter(([level]) => level !== 'log'), []);
    boot(file);
    assert.deepEqual(rawTokens(file, id), written, 'a later boot changes nothing');
  });
});

describe('tokens with TOKEN_ENCRYPTION_KEY', () => {
  test('every writer stores them encrypted (enc:v1:) and every reader gives the plain text back', () => {
    const file = preparedFile();
    let id;
    let written;
    boot(file, {
      key: KEY,
      inspect: (db) => {
        assert.equal(db.tokenEncryptionEnabled, true);
        id = insertStreamer(db.db);
        written = writeAllTokens(db, id, 'sealed');
        assert.deepEqual(tokensOf(db.getStreamerById(id)), written);
      },
    });
    const stored = rawTokens(file, id);
    for (const column of TOKEN_COLUMNS) {
      assert.match(stored[column], /^enc:v1:/, column);
      assert.equal(secretBox.open(stored[column], KEY), written[column], column);
    }
  });

  test('no token is ever handed out encrypted, by any query that returns streamer rows', () => {
    const file = preparedFile();
    let checked = 0;
    boot(file, {
      key: KEY,
      inspect: (db) => {
        const id = insertStreamer(db.db, {
          discord_user_id: '499999999999999901', twitch_user_id: '9901', twitch_username: 'synthetic_reader',
          overlay_token: 'synthetic-overlay-token', chatbot_enabled: 1, enabled: 1,
          yt_chatbot_enabled: 1, youtube_channel_id: 'UCsynthetic',
          multistream_token: 'synthetic-multistream-token', multistream_active_broadcast_id: 'synthetic-broadcast',
        });
        const written = writeAllTokens(db, id, 'reader');
        const one = (row) => [row];
        const mine = (rows) => rows.filter((row) => row.id === id);
        const readers = {
          getStreamerById: () => one(db.getStreamerById(id)),
          getStreamerByDiscordId: () => one(db.getStreamerByDiscordId('499999999999999901')),
          getStreamerByTwitchId: () => one(db.getStreamerByTwitchId('9901')),
          getStreamerByUsername: () => one(db.getStreamerByUsername('SYNTHETIC_READER')),
          getStreamerByOverlayToken: () => one(db.getStreamerByOverlayToken('synthetic-overlay-token')),
          getStreamerByMultistreamToken: () => one(db.getStreamerByMultistreamToken('synthetic-multistream-token')),
          upsertStreamerDiscord: () => one(db.upsertStreamerDiscord('499999999999999901', 'reader', 'Reader', null)),
          getAllStreamers: () => mine(db.getAllStreamers()),
          getAllStreamersAdmin: () => mine(db.getAllStreamersAdmin()),
          getOverlayEnabledStreamers: () => mine(db.getOverlayEnabledStreamers()),
          getChatbotEnabledStreamers: () => mine(db.getChatbotEnabledStreamers()),
          getYoutubeChatbotEnabledStreamers: () => mine(db.getYoutubeChatbotEnabledStreamers()),
          getStreamersWithActiveMultistreamBroadcast: () => mine(db.getStreamersWithActiveMultistreamBroadcast()),
        };
        for (const [name, read] of Object.entries(readers)) {
          const rows = read();
          assert.equal(rows.length, 1, `${name} finds the streamer`);
          const tokens = tokensOf(rows[0]);
          assert.ok(Object.keys(tokens).length > 0, `${name} returns token columns`);
          for (const [column, value] of Object.entries(tokens)) assert.equal(value, written[column], `${name}: ${column}`);
          for (const value of Object.values(rows[0])) assert.ok(!secretBox.isSealed(value), `${name}: nothing encrypted`);
          checked++;
        }
      },
    });
    assert.equal(checked, 13);
  });

  test('every query of db.js that reads or writes token columns is one of those covered here', () => {
    // A query added later that returns token columns must pass its rows through
    // openTokens (and join the readers above); one that writes them must use sealToken.
    const source = fs.readFileSync(DB_FILE, 'utf8');
    const readers = new Set();
    const writers = new Set();
    // SQL in template literals, single or double quotes.
    for (const m of source.matchAll(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g)) {
      const sql = m[0];
      if (!/\bstreamers\b/.test(sql)) continue;
      const owner = [...source.slice(0, m.index).matchAll(/\n(?:const (\w+) = db\.prepare\(|function (\w+)\()/g)].pop();
      const name = owner && (owner[1] || owner[2]);
      const mentionsTokens = TOKEN_COLUMNS.some((c) => sql.includes(c));
      // The streamers table read directly (FROM) or joined (JOIN), with or
      // without an alias: all its columns come back with *, streamers.* or <alias>.*.
      const table = /\b(?:FROM|JOIN)\s+streamers\b(?:\s+(?:AS\s+)?(?!(?:WHERE|ON|JOIN|LEFT|INNER|CROSS|ORDER|GROUP|LIMIT|USING)\b)(\w+))?/i.exec(sql);
      if (/^\W*SELECT\b/i.test(sql) && table) {
        const alias = table[1];
        const allColumns = /\bSELECT\s+(?:DISTINCT\s+)?\*/i.test(sql) || /\bstreamers\.\*/i.test(sql) || (alias && new RegExp(`\\b${alias}\\.\\*`).test(sql));
        if (mentionsTokens || allColumns) readers.add(name);
      }
      if (/RETURNING\s+\*/i.test(sql)) readers.add(name);
      if (/^\W*(UPDATE|INSERT)\b/i.test(sql) && mentionsTokens) writers.add(name);
    }
    assert.deepEqual([...readers].sort(), [
      '_getAllStreamers', '_getAllStreamersAdmin', '_getStreamerByDiscordId', '_getStreamerById', '_getStreamerByTwitchId',
      'upsertStreamerDiscord', 'getChatbotEnabledStreamers', 'getOverlayEnabledStreamers', 'getStreamerByMultistreamToken',
      'getStreamerByOverlayToken', 'getStreamerByUsername', 'getStreamersWithActiveMultistreamBroadcast', 'getYoutubeChatbotEnabledStreamers',
    ].sort());
    assert.deepEqual([...writers].sort(), ['_updateStreamerBroadcasterTokens', 'updateBotTokens', 'updateSpotifyTokens', 'updateStreamerYoutubeAccessToken', 'updateStreamerYoutubeTokens'].sort());
  });

  test('the check above sees joined and double-quoted queries too', () => {
    // What it would catch: a JOIN that returns the streamer's columns, and SQL in double quotes.
    const flagged = (sql) => /\b(?:FROM|JOIN)\s+streamers\b(?:\s+(?:AS\s+)?(?!(?:WHERE|ON|JOIN|LEFT|INNER|CROSS|ORDER|GROUP|LIMIT|USING)\b)(\w+))?/i.exec(sql);
    const joined = 'SELECT g.guild_id, s.* FROM guilds g JOIN streamers s ON g.streamer_id = s.id';
    assert.equal(flagged(joined)[1], 's');
    assert.equal(flagged('SELECT guilds.*, streamers.twitch_username FROM guilds JOIN streamers ON guilds.streamer_id = streamers.id')[1], undefined);
    assert.ok('x = db.prepare("SELECT yt_access_token FROM streamers WHERE id = ?")'.match(/"[^"\n]*"/)[0].includes('yt_access_token'));
  });

  test('no column whitelist of a dynamic UPDATE names a token column, except OVERLAY_COLUMNS (whose writer seals it)', () => {
    // A dynamic UPDATE takes its column names from a Set or an object of
    // allowed names; a token column there would be written without sealToken.
    const source = fs.readFileSync(DB_FILE, 'utf8');
    const lists = [
      ...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*new Set\(\[([\s\S]*?)\]\)/g),
      ...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\{([^{}]*)\}/g),
    ].map((m) => ({ name: m[1], body: m[2] }));
    for (const known of ['OVERLAY_COLUMNS', 'CHATBOT_COLUMNS', 'YT_CHATBOT_COLUMNS', 'BUILTIN_CMD_COLUMNS', 'MODERATION_COLUMNS', 'allowed']) {
      assert.ok(lists.some(({ name }) => name === known), `the scan finds ${known}`);
    }
    const naming = lists.filter(({ body }) => TOKEN_COLUMNS.some((c) => new RegExp(`['"\`]${c}['"\`]`).test(body)));
    assert.deepEqual(naming.map(({ name }) => name), ['OVERLAY_COLUMNS']);
  });

  test('a renewed YouTube token is stored encrypted, and the channel name is left as it was', () => {
    const file = preparedFile();
    let id;
    boot(file, {
      key: KEY,
      inspect: (db) => {
        id = insertStreamer(db.db);
        db.updateStreamerYoutubeTokens(id, 'yt-first-access', 'yt-first-refresh', Date.now() + 1000, 'Synthetic Channel');
        db.updateStreamerYoutubeAccessToken(id, 'yt-renewed-access', 'yt-renewed-refresh', Date.now() + 3_600_000);
        const streamer = db.getStreamerById(id);
        assert.equal(streamer.yt_access_token, 'yt-renewed-access');
        assert.equal(streamer.yt_refresh_token, 'yt-renewed-refresh');
        assert.equal(streamer.yt_channel_name, 'Synthetic Channel');
      },
    });
    const stored = rawTokens(file, id);
    assert.equal(secretBox.open(stored.yt_access_token, KEY), 'yt-renewed-access');
    assert.equal(secretBox.open(stored.yt_refresh_token, KEY), 'yt-renewed-refresh');
  });

  test('null and an empty value are stored as they are', () => {
    const file = preparedFile();
    let id;
    boot(file, {
      key: KEY,
      inspect: (db) => {
        id = insertStreamer(db.db);
        db.updateSpotifyTokens(id, null, '', null);
        db.updateOverlayConfig(id, { streamelements_jwt: null });
        const streamer = db.getStreamerById(id);
        assert.equal(streamer.spotify_access_token, null);
        assert.equal(streamer.spotify_refresh_token, '');
      },
    });
    const stored = rawTokens(file, id);
    assert.equal(stored.spotify_access_token, null);
    assert.equal(stored.spotify_refresh_token, '');
    assert.equal(stored.streamelements_jwt, null);
  });
});

describe('the boot migration', () => {
  // Production today: tokens stored in plain text, as before this change.
  function productionLikeFile() {
    const file = preparedFile();
    const plain = plainTokens('legacy');
    const ids = raw(file, (h) => ({
      full: insertStreamer(h, plain),
      partial: insertStreamer(h, { broadcaster_access_token: 'legacy-only-access', streamelements_jwt: '' }),
      none: insertStreamer(h),
    }));
    return { file, plain, ids };
  }

  test('with the key, tokens stored in plain text are read as they are, then encrypted at boot; a second boot changes nothing', () => {
    const { file, plain, ids } = productionLikeFile();

    const first = boot(file, {
      key: KEY,
      inspect: (db) => {
        assert.deepEqual(tokensOf(db.getStreamerById(ids.full)), plain);
        assert.equal(db.getStreamerById(ids.partial).broadcaster_access_token, 'legacy-only-access');
      },
    });
    assert.ok(first.some(([level, line]) => level === 'log' && line === '[DB] Encrypted 10 stored token(s) with TOKEN_ENCRYPTION_KEY'), JSON.stringify(first));
    assert.deepEqual(first.filter(([level]) => level === 'error'), []);

    const encrypted = rawTokens(file, ids.full);
    for (const column of TOKEN_COLUMNS) {
      assert.match(encrypted[column], /^enc:v1:/, column);
      assert.equal(secretBox.open(encrypted[column], KEY), plain[column], column);
    }
    const partial = rawTokens(file, ids.partial);
    assert.equal(secretBox.open(partial.broadcaster_access_token, KEY), 'legacy-only-access');
    assert.equal(partial.streamelements_jwt, '', 'an empty value stays empty');
    assert.equal(partial.spotify_access_token, null);
    assert.deepEqual(Object.values(rawTokens(file, ids.none)).filter((v) => v !== null), []);

    const second = boot(file, { key: KEY, inspect: (db) => assert.deepEqual(tokensOf(db.getStreamerById(ids.full)), plain) });
    assert.deepEqual(rawTokens(file, ids.full), encrypted, 'not encrypted again');
    assert.deepEqual(second.filter(([, line]) => /Encrypted|cannot be decrypted/.test(line)), []);
  });

  test('without the key nothing is encrypted', () => {
    const { file, plain, ids } = productionLikeFile();
    const logs = boot(file);
    assert.deepEqual(rawTokens(file, ids.full), plain);
    assert.deepEqual(logs.filter(([, line]) => /Encrypted|cannot be decrypted/.test(line)), []);
  });

  test('if the key is later removed or changed, encrypted tokens read as not connected (never as the encrypted text), the boot says so, and they are kept for when the key is back', () => {
    const { file, plain, ids } = productionLikeFile();
    boot(file, { key: KEY });
    const encrypted = rawTokens(file, ids.full);

    for (const key of [null, OTHER_KEY]) {
      const logs = boot(file, {
        key,
        inspect: (db) => {
          const streamer = db.getStreamerById(ids.full);
          for (const column of TOKEN_COLUMNS) assert.equal(streamer[column], null, `${key ? 'other key' : 'no key'}: ${column}`);
          assert.equal(db.getStreamerById(ids.partial).broadcaster_access_token, null);
          // A streamer who connects again meanwhile gets a working token.
          db.updateSpotifyTokens(ids.none, 'reconnected-access', 'reconnected-refresh', Date.now() + 3_600_000);
          assert.equal(db.getStreamerById(ids.none).spotify_access_token, 'reconnected-access');
        },
      });
      const errors = logs.filter(([level]) => level === 'error').map(([, line]) => line);
      assert.ok(errors.some((line) => line.startsWith('[DB] 10 stored token(s) of 2 streamer(s) cannot be decrypted')), JSON.stringify(errors));
      assert.ok(errors.every((line) => !line.includes('legacy-')), 'no token in the log');
      assert.deepEqual(rawTokens(file, ids.full), encrypted, 'the encrypted tokens are left as they are');
    }

    boot(file, { key: KEY, inspect: (db) => assert.deepEqual(tokensOf(db.getStreamerById(ids.full)), plain) });
  });
});

// ── Session ids ──────────────────────────────────────────────────────────

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const DISCORD_SID = '0b6f9c2e-3d4a-4f5b-8c6d-7e8f9a0b1c2d'; // crypto.randomUUID() form
const RACING_SID = 'a1'.repeat(32); // crypto.randomBytes(32).toString('hex') form
const storedSids = (file) => raw(file, (h) => h.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid));

describe('session ids', () => {
  test('are stored as their SHA-256 and found, ended and kept by the cookie\'s value', () => {
    const file = preparedFile();
    const soon = Date.now() + 60_000;
    boot(file, {
      inspect: (db) => {
        const streamer = insertStreamer(db.db);
        const other = insertStreamer(db.db);
        const racer = Number(db.db.prepare("INSERT INTO racing_users (username, password_hash) VALUES ('synthetic_racer', 'x')").run().lastInsertRowid);

        db.createSession(DISCORD_SID, streamer, soon);
        db.createRacingSession(RACING_SID, racer, soon);
        db.createLinkedSession('c3'.repeat(32), streamer, racer, soon);
        db.createSession('second-device', streamer, soon);
        db.createSession('other-streamer', other, soon);

        assert.equal(db.hashSessionId(DISCORD_SID), sha256(DISCORD_SID));
        const sids = db.db.prepare('SELECT sid FROM sessions').all().map((r) => r.sid);
        for (const cookie of [DISCORD_SID, RACING_SID, 'second-device']) {
          assert.ok(sids.includes(sha256(cookie)), `${cookie} is stored hashed`);
          assert.ok(!sids.includes(cookie), `${cookie} is not stored as it is`);
        }

        assert.equal(db.getSession(DISCORD_SID).streamer_id, streamer);
        assert.equal(db.getSession(RACING_SID).racing_user_id, racer);
        assert.equal(db.getSession(sha256(DISCORD_SID)), undefined, 'what the table holds does not log anyone in');

        // "Log out other devices" (Racing account page) keeps the current one.
        db.deleteOtherSessions(RACING_SID, { racingUserId: racer });
        assert.ok(db.getSession(RACING_SID));
        assert.equal(db.getSession('c3'.repeat(32)), undefined);

        // Logout ends that session only.
        db.deleteSession(DISCORD_SID);
        assert.equal(db.getSession(DISCORD_SID), undefined);
        assert.ok(db.getSession('second-device'));

        // Disabling an account ends all of its sessions (by streamer_id), nobody else's.
        db.disableStreamer(streamer, 'synthetic note');
        assert.equal(db.getSession('second-device'), undefined);
        assert.ok(db.getSession('other-streamer'));

        // Expired sessions are not found and are cleaned up.
        db.createSession('expired', other, Date.now() - 1);
        assert.equal(db.getSession('expired'), undefined);
        db.cleanExpiredSessions();
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE sid = ?').get(sha256('expired')).n, 0);
      },
    });
  });

  test('ids stored before this change are hashed once at boot: every cookie keeps working, and a later boot hashes nothing again', () => {
    const file = preparedFile();
    const soon = Date.now() + 60_000;
    let ids;
    // Production before this change: ids stored as they are, the migration not recorded.
    raw(file, (h) => {
      const streamer = insertStreamer(h);
      const racer = Number(h.prepare("INSERT INTO racing_users (username, password_hash) VALUES ('legacy_racer', 'x')").run().lastInsertRowid);
      const add = h.prepare('INSERT INTO sessions (sid, streamer_id, racing_user_id, expires_at) VALUES (?, ?, ?, ?)');
      add.run(DISCORD_SID, streamer, null, soon);
      add.run(RACING_SID, null, racer, soon);
      add.run('d4'.repeat(32), streamer, racer, soon);
      h.prepare("DELETE FROM data_migrations WHERE name = 'hash_web_session_ids'").run();
      ids = { streamer, racer };
    });

    const logs = boot(file, {
      inspect: (db) => {
        assert.equal(db.getSession(DISCORD_SID).streamer_id, ids.streamer, 'Discord login still logged in');
        assert.equal(db.getSession(RACING_SID).racing_user_id, ids.racer, 'Racing login still logged in');
        assert.equal(db.getSession('d4'.repeat(32)).racing_user_id, ids.racer, 'linked login still logged in');
        // A session made after the migration, in the same 64-hex form a hash has.
        db.createRacingSession('e5'.repeat(32), ids.racer, soon);
      },
    });
    assert.ok(logs.some(([, line]) => line === '[DB] Stored 3 web session id(s) as hashes'), JSON.stringify(logs));
    assert.deepEqual(logs.filter(([level]) => level === 'error'), []);
    const hashed = storedSids(file);
    assert.deepEqual(hashed, [DISCORD_SID, RACING_SID, 'd4'.repeat(32), 'e5'.repeat(32)].map(sha256).sort());

    const again = boot(file, {
      inspect: (db) => {
        for (const cookie of [DISCORD_SID, RACING_SID, 'd4'.repeat(32), 'e5'.repeat(32)]) assert.ok(db.getSession(cookie), cookie);
      },
    });
    assert.deepEqual(storedSids(file), hashed, 'nothing hashed twice');
    assert.deepEqual(again.filter(([, line]) => /web session/.test(line)), []);
  });
});
