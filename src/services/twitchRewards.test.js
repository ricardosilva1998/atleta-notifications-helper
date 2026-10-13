'use strict';

// Channel point rewards: what happens to a reward row when an edit, a delete or a
// sync succeeds or fails on Twitch, and what happens to a redemption of a reward
// that must not play. The real src/db.js on in-memory SQLite, the real
// twitchRewards.js and redemptionDispatcher.js, and a fake Helix in place of
// fetch (nothing leaves the machine). All ids and names are synthetic.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const RealDatabase = require('better-sqlite3');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const DB_FILE = path.join(__dirname, '..', 'db.js');
const realFs = fs;
const saved = {};
let db;
let rewards;
let dispatcher;

before(() => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    return saved.load(request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) { saved[level] = console[level]; console[level] = () => {}; }
  saved.fetch = global.fetch;

  db = require(DB_FILE);
  rewards = require('./twitchRewards');
  dispatcher = require('./redemptionDispatcher');
});

after(() => {
  Module._load = saved.load;
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  global.fetch = saved.fetch;
});

// ── A fake Helix ─────────────────────────────────────────────────────────

let helix;

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body || {}, text: async () => JSON.stringify(body || {}) };
}

// Rewards Twitch has (`upstream`), every request made (`calls`), and failures to
// hand out: helix.fail('DELETE', { status: 500 }) fails the next DELETE, and
// helix.fail('PATCH', { status: 403, message: '...' }, { repeat: true }) every PATCH.
function newHelix() {
  const state = { upstream: [], calls: [], failures: [], created: 0 };
  state.fail = (method, failure, options = {}) => state.failures.push({ method, failure, repeat: !!options.repeat });
  state.callsTo = (method, suffix) => state.calls.filter((c) => c.method === method && c.path.endsWith(suffix));

  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const pathname = u.pathname.replace('/helix', '');
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    state.calls.push({ method, path: pathname, query: Object.fromEntries(u.searchParams), body, signal: opts.signal });

    const index = state.failures.findIndex((f) => f.method === method);
    if (index >= 0) {
      const { failure, repeat } = state.failures[index];
      if (!repeat) state.failures.splice(index, 1);
      if (failure.throws) throw new Error(failure.throws);
      return reply(failure.status, { message: failure.message || 'failed' });
    }

    if (pathname.endsWith('/custom_rewards/redemptions')) return reply(200, { data: [{ status: body.status }] });
    if (pathname.endsWith('/custom_rewards')) {
      const id = u.searchParams.get('id');
      if (method === 'GET') return reply(200, { data: state.upstream });
      if (method === 'POST') {
        const created = { id: `created-${++state.created}`, ...body };
        state.upstream.push(created);
        return reply(200, { data: [created] });
      }
      const found = state.upstream.find((r) => r.id === id);
      if (!found) return reply(404, { message: 'reward not found' });
      if (method === 'PATCH') { Object.assign(found, body); return reply(200, { data: [found] }); }
      if (method === 'DELETE') { state.upstream.splice(state.upstream.indexOf(found), 1); return { ok: true, status: 204, json: async () => null, text: async () => '' }; }
    }
    throw new Error(`unexpected request ${method} ${url}`);
  };
  return state;
}

// ── Streamers, rewards and a media folder ────────────────────────────────

let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = {
    discord_user_id: `40000000000000${String(n).padStart(4, '0')}`, discord_username: `streamer${n}`,
    twitch_user_id: `9${n}`, broadcaster_access_token: 'synthetic-token', broadcaster_refresh_token: 'synthetic-refresh',
    ...over,
  };
  const names = Object.keys(cols);
  const info = db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k]));
  return Number(info.lastInsertRowid);
}

// A reward row. `twitchId` null means it has not been created on Twitch.
function addReward(streamerId, { twitchId = null, ...over } = {}) {
  const row = db.insertReward({
    streamer_id: streamerId, title: 'Air Horn', cost: 500, prompt: null, cooldown_seconds: 0, enabled: 1,
    media_type: 'audio', media_filename: `zz-test-${++counter}.mp3`, media_mime: 'audio/mpeg', media_size_bytes: 10,
    position_preset: 'center-large', custom_x: null, custom_y: null, custom_w: null, custom_h: null,
    volume: 1, max_play_seconds: 15, chat_message_template: null, auto_fulfill: 1, sort_order: 0, twitch_sync_status: 'ok',
    ...over,
  });
  if (twitchId) db.setRewardTwitchId(row.id, twitchId, over.twitch_sync_status || 'ok');
  return Number(row.id);
}

// What Twitch has for a reward row.
const upstreamOf = (twitchId, over = {}) => ({
  id: twitchId, title: 'Air Horn', cost: 500, prompt: '', is_paused: false, is_global_cooldown_enabled: false, global_cooldown_seconds: 0, ...over,
});

const row = (rewardId, streamerId) => db.getRewardById(rewardId, streamerId);
const streamerOf = (id) => db.getStreamerById(id);

let mediaDir;
beforeEach(() => {
  // Twitch reward ids are unique across the table (as real ones are): each test starts with none.
  db.db.prepare('DELETE FROM channel_point_redemptions').run();
  db.db.prepare('DELETE FROM channel_point_rewards').run();
  helix = newHelix();
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewards-test-'));
});
afterEach(() => {
  global.fetch = saved.fetch;
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

function mediaFile(reward) {
  const file = path.join(mediaDir, reward.media_filename);
  fs.writeFileSync(file, 'audio');
  return file;
}

// ── Deleting a reward ────────────────────────────────────────────────────

describe('deleting a reward', () => {
  let id;
  beforeEach(() => { id = addStreamer(); });

  test('is done once Twitch has deleted it: the row and its media file go', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    const file = mediaFile(row(rewardId, id));

    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });

    assert.deepEqual(result, { removed: true });
    assert.equal(row(rewardId, id), undefined);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(helix.upstream, []);
    assert.equal(helix.callsTo('DELETE', '/custom_rewards')[0].query.id, 'tw-1');
  });

  test('a reward Twitch no longer has (404) is removed here too', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-gone' });
    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.deepEqual(result, { removed: true });
    assert.equal(row(rewardId, id), undefined);
  });

  test('a reward that was never created on Twitch is removed without asking Twitch', async () => {
    const rewardId = addReward(id, { twitchId: null, twitch_sync_status: 'create_failed' });
    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.deepEqual(result, { removed: true });
    assert.equal(row(rewardId, id), undefined);
    assert.deepEqual(helix.calls, []);
  });

  test('when Twitch refuses, the row stays as delete_failed with the reason, and so does its media file', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    helix.fail('DELETE', { status: 500, message: 'Twitch is having a problem' });
    const file = mediaFile(row(rewardId, id));

    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });

    assert.equal(result.removed, false);
    assert.match(result.error.message, /500/);
    const kept = row(rewardId, id);
    assert.equal(kept.twitch_sync_status, 'delete_failed');
    assert.match(kept.twitch_sync_error, /Twitch is having a problem/);
    assert.equal(fs.existsSync(file), true);
    assert.equal(helix.upstream.length, 1, 'the reward is still live on Twitch');
  });

  test('a refusal for lost permission (403) is a failure too, not "already gone"', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    helix.fail('DELETE', { status: 403, message: 'The broadcaster has not authorized this app' });
    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.equal(result.removed, false);
    assert.equal(row(rewardId, id).twitch_sync_status, 'delete_failed');
  });

  test('a 403 about affiliate status (which helixBroadcaster does not throw) is a failure too', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.fail('DELETE', { status: 403, message: 'The broadcaster must be an affiliate or partner' });
    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.equal(result.removed, false);
    assert.equal(row(rewardId, id).twitch_sync_status, 'delete_failed');
    assert.match(row(rewardId, id).twitch_sync_error, /Affiliate or Partner/);
  });

  test('a network error or timeout is a failure too', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.fail('DELETE', { throws: 'The operation was aborted due to timeout' });
    const result = await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.equal(result.removed, false);
    assert.equal(row(rewardId, id).twitch_sync_status, 'delete_failed');
  });

  test('every Helix request has a timeout', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.ok(helix.calls.length > 0);
    for (const call of helix.calls) assert.ok(call.signal instanceof AbortSignal, `${call.method} ${call.path}`);
  });

  test('retrying a delete that now works removes the row', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    helix.fail('DELETE', { status: 500 });
    await rewards.removeReward(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.equal(row(rewardId, id).twitch_sync_status, 'delete_failed');

    const retried = await rewards.retryPending(streamerOf(id), row(rewardId, id), { mediaDir });
    assert.deepEqual({ ok: retried.ok, removed: retried.removed }, { ok: true, removed: true });
    assert.equal(row(rewardId, id), undefined);
  });
});

// ── Editing a reward ─────────────────────────────────────────────────────

describe('editing a reward', () => {
  let id;
  beforeEach(() => { id = addStreamer(); });

  // What the PATCH route does: save the columns, then send them to Twitch.
  async function edit(rewardId, changes) {
    db.updateReward(rewardId, id, changes);
    return rewards.pushRewardChanges(streamerOf(id), rewardId, changes);
  }

  test('sends only what changed, and the row stays ok', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));

    const result = await edit(rewardId, { title: 'Big Horn', enabled: 0 });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(helix.callsTo('PATCH', '/custom_rewards')[0].body, { title: 'Big Horn', is_paused: true });
    assert.equal(row(rewardId, id).twitch_sync_status, 'ok');
    assert.equal(helix.upstream[0].is_paused, true);
  });

  test('a cooldown is sent as on/off plus seconds, and the prompt can be cleared', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    await edit(rewardId, { cooldown_seconds: 90, prompt: 'Say hi' });
    await edit(rewardId, { cooldown_seconds: 0, prompt: null });
    const [first, second] = helix.callsTo('PATCH', '/custom_rewards').map((c) => c.body);
    assert.deepEqual(first, { is_global_cooldown_enabled: true, global_cooldown_seconds: 90, prompt: 'Say hi' });
    assert.deepEqual(second, { is_global_cooldown_enabled: false, prompt: '' });
  });

  test('edits that Twitch does not keep (media, position, volume) are not sent', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    const result = await edit(rewardId, { volume: 0.5, position_preset: 'fullscreen', max_play_seconds: 10, chat_message_template: 'hi' });
    assert.deepEqual(result, { ok: true, skipped: true });
    assert.deepEqual(helix.calls, []);
    assert.equal(row(rewardId, id).twitch_sync_status, 'ok');
  });

  test('a reward not on Twitch yet has nothing to send', async () => {
    const rewardId = addReward(id, { twitchId: null, twitch_sync_status: 'create_failed' });
    assert.deepEqual(await edit(rewardId, { title: 'New title' }), { ok: true, skipped: true });
    assert.deepEqual(helix.calls, []);
    assert.equal(row(rewardId, id).twitch_sync_status, 'create_failed', 'unchanged');
  });

  test('when Twitch refuses, the edit stays saved here and the row says update_failed with the reason', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    helix.fail('PATCH', { status: 500, message: 'Twitch is having a problem' });

    const result = await edit(rewardId, { enabled: 0 });

    assert.equal(result.ok, false);
    const stored = row(rewardId, id);
    assert.equal(stored.enabled, 0, 'the change is saved here');
    assert.equal(stored.twitch_sync_status, 'update_failed');
    assert.match(stored.twitch_sync_error, /Twitch is having a problem/);
    assert.equal(helix.upstream[0].is_paused, false, 'Twitch still has the old value');
  });

  test('the next successful edit sends everything Twitch keeps, so the earlier edit is not lost', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.upstream.push(upstreamOf('tw-1'));
    helix.fail('PATCH', { status: 500 });
    await edit(rewardId, { enabled: 0 }); // fails: Twitch is not paused yet

    const result = await edit(rewardId, { cost: 750 }); // a different edit that works

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(helix.callsTo('PATCH', '/custom_rewards')[1].body, {
      title: 'Air Horn', cost: 750, prompt: '', is_global_cooldown_enabled: false, is_paused: true,
    });
    assert.equal(helix.upstream[0].is_paused, true, 'the earlier "disabled" reached Twitch');
    assert.equal(row(rewardId, id).twitch_sync_status, 'ok');
    assert.equal(row(rewardId, id).twitch_sync_error, null);
  });

  test('a 403 about affiliate status is a failure, not a success', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    helix.fail('PATCH', { status: 403, message: 'The broadcaster must be an affiliate or partner' });
    const result = await edit(rewardId, { title: 'New' });
    assert.equal(result.ok, false);
    assert.equal(row(rewardId, id).twitch_sync_status, 'update_failed');
  });

  test('a reward that is gone from Twitch (404) becomes orphaned', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-gone' });
    const result = await edit(rewardId, { title: 'New' });
    assert.equal(result.ok, false);
    assert.equal(row(rewardId, id).twitch_sync_status, 'orphaned');
  });

  test('a reward waiting to be deleted is not edited on Twitch', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', twitch_sync_status: 'delete_failed' });
    assert.deepEqual(await edit(rewardId, { title: 'New' }), { ok: true, skipped: true });
    assert.deepEqual(helix.calls, []);
  });

  test('retry sends the whole row and clears update_failed', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', title: 'Local title', cost: 800, twitch_sync_status: 'update_failed' });
    helix.upstream.push(upstreamOf('tw-1', { title: 'Old title', cost: 500 }));
    const result = await rewards.retryPending(streamerOf(id), row(rewardId, id));
    assert.equal(result.ok, true);
    assert.equal(helix.upstream[0].title, 'Local title');
    assert.equal(helix.upstream[0].cost, 800);
    assert.equal(row(rewardId, id).twitch_sync_status, 'ok');
  });

  test('retry of a reward with nothing pending says so', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1' });
    const result = await rewards.retryPending(streamerOf(id), row(rewardId, id));
    assert.equal(result.ok, false);
    assert.equal(result.nothingToRetry, true);
    assert.deepEqual(helix.calls, []);
  });
});

// ── The sync ─────────────────────────────────────────────────────────────

describe('syncing with Twitch', () => {
  let id;
  beforeEach(() => { id = addStreamer(); });
  const sync = () => rewards.syncRewards(id);

  test('takes title, cost, prompt, paused and the cooldown from Twitch for a reward that is in step', async () => {
    const paused = addReward(id, { twitchId: 'tw-1', enabled: 1, cooldown_seconds: 0 });
    const running = addReward(id, { twitchId: 'tw-2', enabled: 0, cooldown_seconds: 120 });
    helix.upstream.push(
      upstreamOf('tw-1', { title: 'Renamed on Twitch', cost: 900, prompt: 'Hello', is_paused: true, is_global_cooldown_enabled: true, global_cooldown_seconds: 45 }),
      upstreamOf('tw-2', { is_paused: false, is_global_cooldown_enabled: false, global_cooldown_seconds: 300 }),
    );

    const result = await sync();

    assert.deepEqual({ ok: result.ok, count: result.count, errors: result.errors }, { ok: true, count: 2, errors: [] });
    const first = row(paused, id);
    assert.deepEqual([first.title, first.cost, first.prompt, first.enabled, first.cooldown_seconds],
      ['Renamed on Twitch', 900, 'Hello', 0, 45], 'paused on Twitch = off here');
    const second = row(running, id);
    assert.deepEqual([second.enabled, second.cooldown_seconds], [1, 0], 'running on Twitch = on here; a cooldown that is off is 0');
    assert.equal(first.twitch_sync_status, 'ok');
  });

  test('an edit that Twitch never took is sent, not overwritten by Twitch\'s older values', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', title: 'My new title', enabled: 0, twitch_sync_status: 'update_failed' });
    helix.upstream.push(upstreamOf('tw-1', { title: 'Old title', is_paused: false }));

    const result = await sync();

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(helix.upstream[0].title, 'My new title');
    assert.equal(helix.upstream[0].is_paused, true);
    const synced = row(rewardId, id);
    assert.deepEqual([synced.title, synced.enabled, synced.twitch_sync_status], ['My new title', 0, 'ok']);
  });

  test('an edit Twitch still refuses stays update_failed and is reported', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', title: 'My new title', twitch_sync_status: 'update_failed' });
    helix.upstream.push(upstreamOf('tw-1', { title: 'Old title' }));
    helix.fail('PATCH', { status: 500, message: 'still down' });

    const result = await sync();

    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], new RegExp(`reward ${rewardId}`));
    assert.equal(row(rewardId, id).twitch_sync_status, 'update_failed');
    assert.equal(row(rewardId, id).title, 'My new title', 'the local edit is not lost');
  });

  test('a delete Twitch refused earlier is tried again, and the row goes when it works', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', twitch_sync_status: 'delete_failed' });
    helix.upstream.push(upstreamOf('tw-1'));
    const result = await sync();
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(row(rewardId, id), undefined);
    assert.deepEqual(helix.upstream, []);
  });

  test('a delete Twitch refuses again keeps the row and is reported', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', twitch_sync_status: 'delete_failed' });
    helix.upstream.push(upstreamOf('tw-1'));
    helix.fail('DELETE', { status: 500, message: 'still down' });
    const result = await sync();
    assert.equal(result.errors.length, 1);
    assert.equal(row(rewardId, id).twitch_sync_status, 'delete_failed');
  });

  test('a reward waiting to be deleted that Twitch no longer lists is dropped without another delete', async () => {
    const rewardId = addReward(id, { twitchId: 'tw-1', twitch_sync_status: 'delete_failed' });
    const result = await sync();
    assert.equal(result.ok, true);
    assert.equal(row(rewardId, id), undefined);
    assert.deepEqual(helix.callsTo('DELETE', '/custom_rewards'), []);
  });

  test('a reward Twitch no longer has is marked orphaned, an unsent edit included', async () => {
    const plain = addReward(id, { twitchId: 'tw-1' });
    const edited = addReward(id, { twitchId: 'tw-2', twitch_sync_status: 'update_failed' });
    await sync();
    assert.equal(row(plain, id).twitch_sync_status, 'orphaned');
    assert.equal(row(edited, id).twitch_sync_status, 'orphaned');
  });

  test('a reward that was never created on Twitch is created, as before', async () => {
    const rewardId = addReward(id, { twitchId: null, twitch_sync_status: 'create_failed', title: 'Created by sync', cooldown_seconds: 30, enabled: 0 });
    const result = await sync();
    assert.equal(result.count, 1);
    const created = helix.callsTo('POST', '/custom_rewards')[0].body;
    assert.deepEqual([created.title, created.is_global_cooldown_enabled, created.global_cooldown_seconds, created.is_paused], ['Created by sync', true, 30, true]);
    assert.equal(row(rewardId, id).twitch_reward_id, 'created-1');
    assert.equal(row(rewardId, id).twitch_sync_status, 'ok');
  });

  test('if Twitch cannot be listed, nothing is changed or dropped', async () => {
    const pending = addReward(id, { twitchId: 'tw-1', twitch_sync_status: 'delete_failed' });
    const edited = addReward(id, { twitchId: 'tw-2', twitch_sync_status: 'update_failed' });
    helix.fail('GET', { status: 500, message: 'down' });
    const result = await sync();
    assert.equal(result.ok, false);
    assert.equal(row(pending, id).twitch_sync_status, 'delete_failed');
    assert.equal(row(edited, id).twitch_sync_status, 'update_failed');
    assert.deepEqual(helix.calls.map((c) => c.method), ['GET']);
  });

  test('records when it ran', async () => {
    await sync();
    assert.ok(Date.now() - Date.parse(streamerOf(id).cp_last_sync_at) < 5000);
    assert.equal(streamerOf(id).cp_affiliate_status, 'ok');
  });
});

// ── Redemptions of a reward that must not play ───────────────────────────

describe('a redemption of a reward that is off or deleted', () => {
  let id;
  beforeEach(() => { id = addStreamer(); });

  const redemption = (over = {}) => ({
    twitchRedemptionId: `red-${++counter}`, twitchRewardId: 'tw-1', rewardTitle: 'Air Horn', rewardCost: 500,
    username: 'viewer', userId: '55', userInput: null, status: 'unfulfilled', redeemedAt: '2026-10-13T12:00:00Z', ...over,
  });
  const logged = (redemptionId) => db.getRedemptionsRecent(id, 50).find((r) => r.twitch_redemption_id === redemptionId);

  test('is refunded: the redemption is canceled on Twitch and logged as refunded_disabled', async () => {
    addReward(id, { twitchId: 'tw-1', enabled: 0 });
    const event = redemption();
    await dispatcher.handleRedemption(id, event);

    const [call] = helix.callsTo('PATCH', '/custom_rewards/redemptions');
    assert.deepEqual(call.body, { status: 'CANCELED' });
    assert.deepEqual([call.query.broadcaster_id, call.query.reward_id, call.query.id], [streamerOf(id).twitch_user_id, 'tw-1', event.twitchRedemptionId]);
    const entry = logged(event.twitchRedemptionId);
    assert.deepEqual([entry.outcome, entry.error_message, entry.user_login, entry.cost], ['refunded_disabled', null, 'viewer', 500]);
  });

  test('a reward deleted here but still live on Twitch is refunded as refunded_deleted', async () => {
    addReward(id, { twitchId: 'tw-1', enabled: 1, twitch_sync_status: 'delete_failed' });
    const event = redemption();
    await dispatcher.handleRedemption(id, event);
    assert.equal(helix.callsTo('PATCH', '/custom_rewards/redemptions').length, 1);
    assert.equal(logged(event.twitchRedemptionId).outcome, 'refunded_deleted');
  });

  test('a redemption that is not waiting in the queue cannot be canceled, and is logged as disabled without a call', async () => {
    addReward(id, { twitchId: 'tw-1', enabled: 0 });
    const event = redemption({ status: 'fulfilled' });
    await dispatcher.handleRedemption(id, event);
    assert.deepEqual(helix.calls, []);
    assert.equal(logged(event.twitchRedemptionId).outcome, 'disabled');
  });

  test('if Twitch will not cancel it, the log says error with the reason', async () => {
    addReward(id, { twitchId: 'tw-1', enabled: 0 });
    helix.fail('PATCH', { status: 500, message: 'Twitch is having a problem' });
    const event = redemption();
    await dispatcher.handleRedemption(id, event);
    const entry = logged(event.twitchRedemptionId);
    assert.equal(entry.outcome, 'error');
    assert.match(entry.error_message, /refund failed.*Twitch is having a problem/);
  });

  test('a reward that is on is not refunded for being off (it takes the normal path)', async () => {
    addReward(id, { twitchId: 'tw-1', enabled: 1 });
    const event = redemption();
    await dispatcher.handleRedemption(id, event);
    // No media file exists for the synthetic row, so the existing "file missing"
    // branch refunds it, once, and says so in the log.
    const cancels = helix.callsTo('PATCH', '/custom_rewards/redemptions').filter((c) => c.query.id === event.twitchRedemptionId);
    assert.equal(cancels.length, 1);
    assert.equal(logged(event.twitchRedemptionId).outcome, 'refunded_no_file');
  });

  test('unavailableReason', () => {
    assert.equal(rewards.unavailableReason({ enabled: 1, twitch_sync_status: 'ok' }), null);
    assert.equal(rewards.unavailableReason({ enabled: 0, twitch_sync_status: 'ok' }), 'disabled');
    assert.equal(rewards.unavailableReason({ enabled: 1, twitch_sync_status: 'delete_failed' }), 'deleted');
    assert.equal(rewards.unavailableReason({ enabled: 0, twitch_sync_status: 'delete_failed' }), 'deleted');
    assert.equal(rewards.unavailableReason({ enabled: 1, twitch_sync_status: 'update_failed' }), null);
  });
});
