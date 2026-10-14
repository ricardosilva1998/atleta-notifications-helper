'use strict';

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
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
  // A streamer with the chat bot on, so chat announcements are recorded below.
  getStreamerById() { return { chatbot_enabled: 1, twitch_username: 'synthetic_channel' }; },
  // transaction wraps fn so it behaves inline (synchronous)
  transaction(fn) { return fn; },
};

// What the giveaway announced: chat lines and overlay events.
const announced = { chat: [], overlay: [] };
function _resetAnnounced() {
  announced.chat.length = 0;
  announced.overlay.length = 0;
}
const winnerCards = () => announced.overlay.filter(e => e.type === 'giveaway_winner').map(e => e.data.username);
const congratulations = () => announced.chat.filter(line => line.includes('Congrats'));

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
  if (request === './twitchChat') return { chatManager: { sendMessage(streamerId, line) { announced.chat.push(line); } } };
  if (request === './overlayBus') return { emit(channel, event) { announced.overlay.push(event); } };
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

// pickWinners announces each winner on a timer, and a timed giveaway ends on
// one: every test runs on mocked timers, so none is left running into another.
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'setImmediate'] }); });
afterEach(() => { mock.timers.reset(); });

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

describe('pickWinners — winners are drawn once, unless the streamer re-draws', () => {
  beforeEach(() => {
    _resetDb();
    _resetAnnounced();
  });

  function enter(streamerId, count) {
    for (let i = 0; i < count; i++) {
      mgr.tryAddEntry(streamerId, makeTags({ 'user-id': `uid${i}`, username: `user${i}`, 'display-name': `User${i}` }), '!gw');
    }
  }
  const winnersInDb = (giveawayId) => _entries.filter(e => e.giveaway_id === giveawayId && e.is_winner && !e.is_redrawn_out).map(e => e.id);

  test('a timed giveaway that ended by itself keeps its winners when Pick is clicked afterwards', () => {
    const g = mgr.startGiveaway(7, { keyword: 'gw', prize: 'Test Prize', durationSeconds: 30, winnersCount: 1 });
    enter(7, 3);

    mock.timers.tick(30_000); // the giveaway ends and draws its winner
    mock.timers.tick(1);
    const drawn = winnersInDb(g.id);
    assert.equal(drawn.length, 1);
    assert.equal(winnerCards().length, 1);
    assert.equal(congratulations().length, 1);

    const result = mgr.pickWinners(g.id, 7, {}); // "Pick Winner Now" on a page opened before the end
    mock.timers.tick(5000);

    assert.deepEqual(result.winners.map(w => w.id), drawn, 'answers the winners already drawn');
    assert.equal(result.alreadyDrawn, true);
    assert.deepEqual(winnersInDb(g.id), drawn, 'no second set of winners');
    assert.equal(winnerCards().length, 1, 'no second winner card on the overlay');
    assert.equal(congratulations().length, 1, 'no second congratulation in chat');
  });

  test('clicking Pick twice draws and announces once', () => {
    const g = mgr.startGiveaway(8, { keyword: 'gw', winnersCount: 2 });
    enter(8, 5);
    mgr.closeGiveaway(8, { silent: true });

    const first = mgr.pickWinners(g.id, 8, {});
    const second = mgr.pickWinners(g.id, 8, {});
    mock.timers.tick(5000);

    assert.equal(first.winners.length, 2);
    assert.equal(first.alreadyDrawn, undefined);
    assert.deepEqual(second.winners.map(w => w.id).sort(), first.winners.map(w => w.id).sort());
    assert.equal(second.alreadyDrawn, true);
    assert.equal(winnersInDb(g.id).length, 2);
    assert.equal(winnerCards().length, 2);
  });

  test('Re-draw replaces the winners and announces the new ones; Pick then answers the new ones', () => {
    const g = mgr.startGiveaway(9, { keyword: 'gw', winnersCount: 1 });
    enter(9, 3);
    mgr.closeGiveaway(9, { silent: true });

    const first = mgr.pickWinners(g.id, 9, {});
    const redrawn = mgr.pickWinners(g.id, 9, { redraw: true });
    const pickAgain = mgr.pickWinners(g.id, 9, {});
    mock.timers.tick(5000);

    assert.notEqual(redrawn.winners[0].id, first.winners[0].id);
    assert.deepEqual(winnersInDb(g.id), [redrawn.winners[0].id]);
    assert.deepEqual(pickAgain.winners.map(w => w.id), [redrawn.winners[0].id]);
    assert.equal(pickAgain.alreadyDrawn, true);
    assert.equal(winnerCards().length, 2, 'the first winner and the re-drawn one');
  });

  test('a timed giveaway that ended while the server was down is closed and drawn once at start-up', async () => {
    // init() ends it twice over: from its end timer (due at once) and from a
    // start-up check. Here the timer runs first, then the check (a real setImmediate).
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
    const g = dbStub.insertGiveaway({
      streamer_id: 10, keyword: 'gw', prize: 'Test Prize', status: 'open', winners_count: 1,
      duration_seconds: 60, ends_at: new Date(Date.now() - 60_000).toISOString(),
    });
    for (let i = 0; i < 3; i++) dbStub.insertEntry({ giveaway_id: g.id, twitch_user_id: `uid${i}`, username: `User${i}` });

    const { log } = console;
    console.log = () => {}; // init() reports how many giveaways it picked up
    try {
      mgr.init();
    } finally {
      console.log = log;
    }
    mock.timers.tick(0);
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(5000);

    assert.equal(winnersInDb(g.id).length, 1);
    assert.equal(winnerCards().length, 1);
    assert.equal(congratulations().length, 1);
    assert.equal(announced.chat.filter(line => line.includes('Giveaway closed')).length, 1);
  });
});
