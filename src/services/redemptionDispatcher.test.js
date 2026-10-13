const { test } = require('node:test');
const assert = require('node:assert/strict');
// Import the pure template module directly — it has no external deps and does not
// touch config or DB, so it runs cleanly without environment variables.
const { formatChatTemplate } = require('./redemptionTemplates');

test('replaces all three placeholders', () => {
  const result = formatChatTemplate('{user} redeemed {title} for {cost}', {
    user: 'Bob',
    title: 'Air Horn',
    cost: 500,
  });
  assert.equal(result, 'Bob redeemed Air Horn for 500');
});

test('returns null for null template', () => {
  const result = formatChatTemplate(null, { user: 'Bob', title: 'Air Horn', cost: 500 });
  assert.equal(result, null);
});

test('returns null for empty string template', () => {
  const result = formatChatTemplate('', { user: 'Bob', title: 'Air Horn', cost: 500 });
  assert.equal(result, null);
});

test('passes through static text with no placeholders', () => {
  const result = formatChatTemplate('static text', { user: 'Bob', title: 'Air Horn', cost: 500 });
  assert.equal(result, 'static text');
});

test('no double-replacement when user value contains a placeholder pattern', () => {
  // If user is literally "{cost}", the {cost} in the template should still become "999",
  // not trigger a second replacement pass on the substituted user string.
  const result = formatChatTemplate('{user} spent {cost}', {
    user: '{cost}',
    title: 'Test',
    cost: 999,
  });
  // {user} -> "{cost}" (literal string), then {cost} -> "999".
  // The "{cost}" that came from user substitution must NOT be re-substituted.
  assert.equal(result, '{cost} spent 999');
});

test('handles numeric cost correctly', () => {
  const result = formatChatTemplate('Thanks {user}! Cost: {cost} pts', {
    user: 'Alice',
    title: 'SFX',
    cost: 1500,
  });
  assert.equal(result, 'Thanks Alice! Cost: 1500 pts');
});

// ── The redemption flow ──────────────────────────────────────────────────
//
// The real src/db.js on in-memory SQLite, the real dispatcher and
// twitchRewards.js, a fake Helix in place of fetch, a stub chat and a mocked
// clock: nothing leaves the machine and nothing is written under data/.
// All ids and names are synthetic.

const { describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const path = require('path');
const realFs = require('fs');
const Module = require('module');
const RealDatabase = require('better-sqlite3');

describe('the redemption flow', () => {
  const DB_FILE = path.join(__dirname, '..', 'db.js');
  const DISPATCHER_FILE = path.join(__dirname, 'redemptionDispatcher.js');
  const mediaOnDisk = new Set(); // media file names the dispatcher finds on disk
  const chatLines = [];
  const saved = {};
  let db;
  let dispatcher;
  let bus;
  let helix;

  before(() => {
    for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
      process.env[key] = process.env[key] || 'test';
    }
    saved.load = Module._load;
    Module._load = function (request, parent, isMain) {
      const from = parent && parent.filename;
      if (from === DB_FILE) {
        if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
        if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      }
      if (from === DISPATCHER_FILE) {
        if (request === 'fs') return { ...realFs, existsSync: (p) => mediaOnDisk.has(path.basename(p)) };
        if (request === './twitchChat') return { chatManager: { sendRawMessage: (channel, message) => chatLines.push({ channel, message }) } };
      }
      return saved.load.call(this, request, parent, isMain);
    };
    for (const level of ['log', 'warn', 'error']) { saved[level] = console[level]; console[level] = () => {}; }
    saved.fetch = global.fetch;
    db = require(DB_FILE);
    dispatcher = require('./redemptionDispatcher');
    bus = require('./overlayBus');
  });

  after(() => {
    Module._load = saved.load;
    for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
    global.fetch = saved.fetch;
  });

  // Twitch's redemption endpoint. `onCall` sees each request as it arrives.
  function fakeHelix() {
    const state = { calls: [], onCall: null };
    global.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      const call = {
        method: opts.method || 'GET', path: u.pathname.replace('/helix', ''),
        query: Object.fromEntries(u.searchParams), body: opts.body ? JSON.parse(opts.body) : undefined,
      };
      state.calls.push(call);
      if (state.onCall) state.onCall(call);
      if (call.method === 'PATCH' && call.path.endsWith('/custom_rewards/redemptions')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ status: call.body.status }] }) };
      }
      if (call.method === 'GET' && call.path.endsWith('/custom_rewards')) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }
      throw new Error(`unexpected request ${call.method} ${url}`);
    };
    // The statuses a redemption was given on Twitch (FULFILLED, CANCELED), in order.
    state.statusesOf = (event) => state.calls
      .filter((c) => c.path.endsWith('/custom_rewards/redemptions') && c.query.id === event.twitchRedemptionId)
      .map((c) => c.body.status);
    return state;
  }

  // Each test starts with no rewards and no history (in the in-memory database).
  beforeEach(() => {
    db.db.prepare('DELETE FROM channel_point_redemptions').run();
    db.db.prepare('DELETE FROM channel_point_rewards').run();
    mediaOnDisk.clear();
    chatLines.length = 0;
    helix = fakeHelix();
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
    bus.removeAllListeners();
    global.fetch = saved.fetch;
  });

  let n = 0;
  function addStreamer(over = {}) {
    const cols = {
      discord_user_id: `70000000000000${String(++n).padStart(4, '0')}`, discord_username: `streamer${n}`,
      twitch_user_id: `8${n}`, twitch_username: `synthetic_channel_${n}`, broadcaster_access_token: 'synthetic-token',
      broadcaster_refresh_token: 'synthetic-refresh', chatbot_enabled: 1, cp_rewards_enabled: 1, ...over,
    };
    const names = Object.keys(cols);
    const info = db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k]));
    return Number(info.lastInsertRowid);
  }

  // A reward this app made (it is on Twitch). Its media file is not on disk
  // unless the test puts its name in mediaOnDisk.
  function addReward(streamerId, over = {}) {
    const row = db.insertReward({
      streamer_id: streamerId, title: 'Air Horn', cost: 500, prompt: null, cooldown_seconds: 0, enabled: 1,
      media_type: 'audio', media_filename: `synthetic-${++n}.mp3`, media_mime: 'audio/mpeg', media_size_bytes: 10,
      position_preset: 'center-large', custom_x: null, custom_y: null, custom_w: null, custom_h: null,
      volume: 1, max_play_seconds: 5, chat_message_template: '{user} redeemed {title}', auto_fulfill: 1, sort_order: 0,
      twitch_sync_status: 'ok', ...over,
    });
    db.setRewardTwitchId(row.id, `synthetic-reward-${n}`, over.twitch_sync_status || 'ok');
    return db.getRewardById(row.id, streamerId);
  }

  const redemption = (reward, over = {}) => ({
    twitchRedemptionId: `synthetic-redemption-${++n}`, twitchRewardId: reward && reward.twitch_reward_id,
    rewardTitle: 'Air Horn', rewardCost: 500, username: 'Viewer', userId: '55', userInput: null,
    status: 'unfulfilled', redeemedAt: '2026-10-13T12:00:00Z', ...over,
  });

  const outcomes = (event) => db.db.prepare('SELECT outcome FROM channel_point_redemptions WHERE twitch_redemption_id = ?')
    .all(event.twitchRedemptionId).map((r) => r.outcome);

  // The clips sent to a streamer's overlay.
  function clipsFor(streamerId) {
    const clips = [];
    bus.on(`overlay:${streamerId}`, (event) => { if (event.type === 'redemption') clips.push(event.data); });
    return clips;
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  describe('a redemption Twitch delivers more than once', () => {
    test('plays once: one clip, one chat line, one auto-fulfill and one history row', async () => {
      const id = addStreamer();
      const reward = addReward(id);
      mediaOnDisk.add(reward.media_filename);
      const clips = clipsFor(id);
      const event = redemption(reward);

      await dispatcher.handleRedemption(id, event);
      await dispatcher.handleRedemption(id, event);
      mock.timers.tick(6000); // the auto-fulfill waits for the clip (5 s) plus 1 s
      await flush();

      assert.deepEqual(clips.map((c) => c.twitchRedemptionId), [event.twitchRedemptionId]);
      assert.deepEqual(chatLines.map((l) => l.message), ['Viewer redeemed Air Horn']);
      assert.deepEqual(helix.statusesOf(event), ['FULFILLED']);
      assert.deepEqual(outcomes(event), ['played']);
    });

    test('a refund is asked for once, even when both deliveries arrive at the same moment', async () => {
      const id = addStreamer();
      const reward = addReward(id, { enabled: 0 });
      const event = redemption(reward);

      await Promise.all([dispatcher.handleRedemption(id, event), dispatcher.handleRedemption(id, event)]);
      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(helix.statusesOf(event), ['CANCELED']);
      assert.deepEqual(outcomes(event), ['refunded_disabled']);
    });

    test('a missing media file is refunded and reported in chat once', async () => {
      const id = addStreamer();
      const reward = addReward(id); // its file is not on disk
      const event = redemption(reward);

      await dispatcher.handleRedemption(id, event);
      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(helix.statusesOf(event), ['CANCELED']);
      assert.equal(chatLines.length, 1);
      assert.match(chatLines[0].message, /missing media file/);
      assert.deepEqual(outcomes(event), ['refunded_no_file']);
    });
  });

  describe('the redemption is in the history before anything is done for it', () => {
    test('before its clip plays', async () => {
      const id = addStreamer();
      const reward = addReward(id);
      mediaOnDisk.add(reward.media_filename);
      const event = redemption(reward);
      let whenPlayed;
      bus.on(`overlay:${id}`, () => { whenPlayed = outcomes(event); });

      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(whenPlayed, ['pending']);
      assert.deepEqual(outcomes(event), ['played']);
    });

    test('before Twitch is asked for the refund', async () => {
      const id = addStreamer();
      const reward = addReward(id, { enabled: 0 });
      const event = redemption(reward);
      let whenRefunded;
      helix.onCall = () => { whenRefunded = outcomes(event); };

      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(whenRefunded, ['pending']);
      assert.deepEqual(outcomes(event), ['refunded_disabled']);
    });
  });

  describe('the "Enable Channel Point Rewards" switch', () => {
    test('off: nothing plays or is said in chat, and the viewer gets the points back', async () => {
      const id = addStreamer({ cp_rewards_enabled: 0 });
      const reward = addReward(id);
      mediaOnDisk.add(reward.media_filename);
      const clips = clipsFor(id);
      const event = redemption(reward);

      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(clips, []);
      assert.deepEqual(chatLines, []);
      assert.deepEqual(helix.statusesOf(event), ['CANCELED']);
      assert.deepEqual(outcomes(event), ['refunded_disabled']);
    });

    test('off, for a redemption that can no longer be canceled: nothing plays and it is logged as disabled', async () => {
      const id = addStreamer({ cp_rewards_enabled: 0 });
      const reward = addReward(id);
      mediaOnDisk.add(reward.media_filename);
      const clips = clipsFor(id);
      const event = redemption(reward, { status: 'fulfilled' });

      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(clips, []);
      assert.deepEqual(helix.calls, []);
      assert.deepEqual(outcomes(event), ['disabled']);
    });

    test('off: a reward waiting to be deleted is still refunded as deleted', async () => {
      const id = addStreamer({ cp_rewards_enabled: 0 });
      const reward = addReward(id, { twitch_sync_status: 'delete_failed' });
      const event = redemption(reward);

      await dispatcher.handleRedemption(id, event);

      assert.deepEqual(helix.statusesOf(event), ['CANCELED']);
      assert.deepEqual(outcomes(event), ['refunded_deleted']);
    });

    test('on: the clip plays', async () => {
      const id = addStreamer({ cp_rewards_enabled: 1 });
      const reward = addReward(id, { auto_fulfill: 0 });
      mediaOnDisk.add(reward.media_filename);
      const clips = clipsFor(id);
      const event = redemption(reward);

      await dispatcher.handleRedemption(id, event);

      assert.equal(clips.length, 1);
      assert.equal(clips[0].mediaUrl, `/redemptions/${id}/${reward.media_filename}`);
      assert.deepEqual(helix.calls, []);
      assert.deepEqual(outcomes(event), ['played']);
    });
  });

  describe('a reward this app does not manage (made on Twitch or by another app)', () => {
    test('is left alone: no history row, no refund, no sync with Twitch, nothing played or said', async () => {
      const id = addStreamer();
      const clips = clipsFor(id);
      const event = redemption(null, { twitchRewardId: 'synthetic-reward-made-elsewhere' });

      await dispatcher.handleRedemption(id, event);
      await flush();

      assert.deepEqual(outcomes(event), []);
      assert.deepEqual(helix.calls, []);
      assert.deepEqual(clips, []);
      assert.deepEqual(chatLines, []);
    });
  });

  describe('claimRedemption', () => {
    test('records a redemption id once, as pending; setRedemptionOutcome sets the outcome', () => {
      const id = addStreamer();
      const fields = {
        streamer_id: id, twitch_redemption_id: 'synthetic-redemption-claim', twitch_reward_id: 'synthetic-reward-x',
        user_login: 'Viewer', cost: 500, status: 'unfulfilled', redeemed_at: '2026-10-13T12:00:00Z',
      };
      const rowOf = () => db.db.prepare('SELECT * FROM channel_point_redemptions WHERE twitch_redemption_id = ?').get('synthetic-redemption-claim');

      const rowId = db.claimRedemption(fields);
      assert.ok(rowId);
      assert.equal(db.claimRedemption(fields), null, 'a repeat is not recorded again');
      assert.deepEqual([rowOf().outcome, rowOf().is_test, rowOf().cost], ['pending', 0, 500]);

      db.setRedemptionOutcome(rowId, 'error', 'refund failed: synthetic');
      assert.deepEqual([rowOf().outcome, rowOf().error_message], ['error', 'refund failed: synthetic']);
      db.setRedemptionOutcome(rowId, 'played');
      assert.deepEqual([rowOf().outcome, rowOf().error_message], ['played', null]);
    });
  });
});
