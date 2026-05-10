'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal in-memory DB stub ────────────────────────────────────────

let _giveaways = [];
let _entries = [];
let _nextGiveawayId = 1;
let _nextEntryId = 1;

function _resetDb() {
  _giveaways = [];
  _entries = [];
  _nextGiveawayId = 1;
  _nextEntryId = 1;
}

const dbStub = {
  getAllOpenGiveaways() {
    return _giveaways.filter(g => g.status === 'open');
  },
  getActiveGiveaway(streamerId) {
    return _giveaways.find(g => g.streamer_id === streamerId && g.status === 'open') || null;
  },
  getGiveawayById(id, streamerId) {
    return _giveaways.find(g => g.id === id && g.streamer_id === streamerId) || null;
  },
  getGiveawaysHistory(streamerId, limit) {
    return _giveaways
      .filter(g => g.streamer_id === streamerId && g.status === 'closed')
      .slice(0, limit || 25);
  },
  insertGiveaway(fields) {
    const row = {
      id: _nextGiveawayId++,
      streamer_id: fields.streamer_id,
      keyword: fields.keyword,
      prize: fields.prize || null,
      status: fields.status || 'open',
      subs_only: fields.subs_only ? 1 : 0,
      duration_seconds: fields.duration_seconds || null,
      winners_count: fields.winners_count || 1,
      ends_at: fields.ends_at || null,
      started_at: new Date().toISOString(),
      closed_at: null,
      created_at: new Date().toISOString(),
    };
    _giveaways.push(row);
    return row;
  },
  closeGiveaway(id, streamerId) {
    const g = _giveaways.find(g => g.id === id && g.streamer_id === streamerId && g.status === 'open');
    if (g) { g.status = 'closed'; g.closed_at = new Date().toISOString(); return 1; }
    return 0;
  },
  insertEntry(fields) {
    const dup = _entries.find(
      e => e.giveaway_id === fields.giveaway_id && e.twitch_user_id === fields.twitch_user_id
    );
    if (dup) return 0;
    _entries.push({
      id: _nextEntryId++,
      giveaway_id: fields.giveaway_id,
      twitch_user_id: fields.twitch_user_id,
      username: fields.username,
      is_subscriber: fields.is_subscriber ? 1 : 0,
      is_winner: 0,
      is_redrawn_out: 0,
      entered_at: new Date().toISOString(),
    });
    return 1;
  },
  getEntryCount(giveawayId) {
    return _entries.filter(e => e.giveaway_id === giveawayId).length;
  },
  getEntries(giveawayId) {
    return _entries.filter(e => e.giveaway_id === giveawayId);
  },
  getEligibleEntries(giveawayId) {
    return _entries.filter(e => e.giveaway_id === giveawayId && !e.is_redrawn_out);
  },
  getWinners(giveawayId) {
    return _entries.filter(e => e.giveaway_id === giveawayId && e.is_winner);
  },
  markWinners(giveawayId, ids) {
    for (const id of ids) {
      const e = _entries.find(e => e.id === id);
      if (e) e.is_winner = 1;
    }
  },
  markRedrawnOut(giveawayId, ids) {
    for (const id of ids) {
      const e = _entries.find(e => e.id === id);
      if (e) e.is_redrawn_out = 1;
    }
  },
  getStreamerById() { return null; }, // suppress chat calls
  // transaction wraps fn so it behaves inline (synchronous)
  transaction(fn) { return fn; },
};

// ── Module isolation via _load hook ──────────────────────────────────

const Module = require('module');
const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (
    request === '../db' &&
    parent &&
    parent.filename &&
    parent.filename.includes('giveawayManager')
  ) {
    return dbStub;
  }
  if (request === './twitchChat') return { chatManager: { sendRawMessage() {} } };
  if (request === './overlayBus') return { emit() {} };
  return origLoad(request, parent, isMain);
};

// Force fresh load so the stub is injected on first require
delete require.cache[require.resolve('./giveawayManager')];
const mgr = require('./giveawayManager');

// ── Test helpers ─────────────────────────────────────────────────────

function startFresh(streamerId, keyword, subsOnly, winnersCount) {
  _resetDb();
  return mgr.startGiveaway(streamerId, {
    keyword,
    prize: 'Test Prize',
    subsOnly: subsOnly || false,
    durationSeconds: null,
    winnersCount: winnersCount || 1,
  });
}

function makeTags(overrides) {
  return Object.assign({
    'user-id': 'u1',
    username: 'viewer1',
    'display-name': 'Viewer1',
    subscriber: false,
    mod: false,
    badges: {},
  }, overrides);
}

// ── Test suites ───────────────────────────────────────────────────────

describe('tryAddEntry — no active giveaway', () => {
  test('returns false when no giveaway is active', () => {
    _resetDb();
    assert.equal(mgr.tryAddEntry(99, makeTags(), '!gw'), false);
  });
});

describe('tryAddEntry — keyword matching', () => {
  beforeEach(() => { startFresh(1, 'gw', false); });

  test('"!gw" matches (exact)', () => {
    assert.equal(mgr.tryAddEntry(1, makeTags({ 'user-id': 'u1' }), '!gw'), true);
  });

  test('"!GW" matches (case-insensitive)', () => {
    assert.equal(mgr.tryAddEntry(1, makeTags({ 'user-id': 'u2' }), '!GW'), true);
  });

  test('"hi !gw" does NOT match (must be first word)', () => {
    assert.equal(mgr.tryAddEntry(1, makeTags({ 'user-id': 'u3' }), 'hi !gw'), false);
  });

  test('"!gws" does NOT match (different keyword)', () => {
    assert.equal(mgr.tryAddEntry(1, makeTags({ 'user-id': 'u4' }), '!gws'), false);
  });
});

describe('tryAddEntry — subs-only giveaway', () => {
  beforeEach(() => { startFresh(2, 'gw', true); });

  test('rejects regular viewer (no sub, no mod, no broadcaster)', () => {
    assert.equal(
      mgr.tryAddEntry(2, makeTags({ 'user-id': 'u10', subscriber: false, mod: false, badges: {} }), '!gw'),
      false
    );
  });

  test('accepts subscriber (string "1")', () => {
    assert.equal(
      mgr.tryAddEntry(2, makeTags({ 'user-id': 'u11', subscriber: '1', mod: false, badges: {} }), '!gw'),
      true
    );
  });

  test('accepts mod (not subscribed)', () => {
    assert.equal(
      mgr.tryAddEntry(2, makeTags({ 'user-id': 'u12', subscriber: false, mod: true, badges: {} }), '!gw'),
      true
    );
  });

  test('accepts broadcaster', () => {
    assert.equal(
      mgr.tryAddEntry(2, makeTags({ 'user-id': 'u13', subscriber: false, mod: false, badges: { broadcaster: '1' } }), '!gw'),
      true
    );
  });
});

describe('tryAddEntry — open giveaway accepts everyone', () => {
  beforeEach(() => { startFresh(3, 'gw', false); });

  test('regular viewer enters successfully', () => {
    assert.equal(
      mgr.tryAddEntry(3, makeTags({ 'user-id': 'u20', subscriber: false, mod: false, badges: {} }), '!gw'),
      true
    );
  });
});

describe('pickWinners', () => {
  test('empty eligible list returns { winners: [] }', () => {
    const g = startFresh(4, 'gw', false);
    mgr.closeGiveaway(4, { silent: true });
    const result = mgr.pickWinners(g.id, 4, {});
    assert.deepEqual(result, { winners: [] });
  });

  test('with 5 entries and winnersCount=2, returns 2 distinct winners', () => {
    const g = startFresh(5, 'gw', false, 2);
    for (let i = 0; i < 5; i++) {
      mgr.tryAddEntry(5, makeTags({ 'user-id': `uid${i}`, username: `user${i}`, 'display-name': `User${i}` }), '!gw');
    }
    mgr.closeGiveaway(5, { silent: true });
    const result = mgr.pickWinners(g.id, 5, {});
    assert.equal(result.winners.length, 2);
    const uniqueIds = new Set(result.winners.map(w => w.twitch_user_id));
    assert.equal(uniqueIds.size, 2, 'winners must be distinct');
  });

  test('redraw=true excludes prior winners', () => {
    const g = startFresh(6, 'gw', false, 1);
    for (let i = 0; i < 3; i++) {
      mgr.tryAddEntry(6, makeTags({ 'user-id': `uid${i}`, username: `user${i}`, 'display-name': `User${i}` }), '!gw');
    }
    mgr.closeGiveaway(6, { silent: true });

    const first = mgr.pickWinners(g.id, 6, {});
    assert.equal(first.winners.length, 1);
    const firstWinnerId = first.winners[0].twitch_user_id;

    const second = mgr.pickWinners(g.id, 6, { redraw: true });
    assert.equal(second.winners.length, 1);
    assert.notEqual(second.winners[0].twitch_user_id, firstWinnerId, 'redraw must exclude prior winner');
  });
});
