'use strict';

const crypto = require('crypto');
const db = require('../db');

// streamerId (number) -> { giveawayId, keyword, subsOnly, winnersCount, prize, watchdogTimer }
const activeStates = new Map();

function init() {
  const open = db.getAllOpenGiveaways();
  for (const g of open) {
    _track(g);
    // If ends_at already passed (server was down), fire auto-end immediately
    if (g.ends_at && new Date(g.ends_at) <= new Date()) {
      setImmediate(() => _autoEnd(g.streamer_id));
    }
  }
  console.log(`[Giveaway] init: rehydrated ${open.length} active giveaway${open.length === 1 ? '' : 's'}`);
}

function startGiveaway(streamerId, opts) {
  const { keyword, prize, subsOnly, durationSeconds, winnersCount } = opts || {};

  if (!keyword || !/^[a-zA-Z0-9]{1,25}$/.test(keyword)) {
    throw new Error('invalid_keyword');
  }
  const normalizedKeyword = keyword.toLowerCase();

  if (prize !== undefined && prize !== null && String(prize).length > 100) {
    throw new Error('invalid_prize');
  }

  const wc = parseInt(winnersCount, 10) || 1;
  if (wc < 1 || wc > 10) throw new Error('invalid_winners_count');

  let ds = null;
  if (durationSeconds !== undefined && durationSeconds !== null && durationSeconds !== '') {
    ds = parseInt(durationSeconds, 10);
    if (isNaN(ds) || ds < 30 || ds > 86400) throw new Error('invalid_duration');
  }

  const existing = db.getActiveGiveaway(streamerId);
  if (existing) throw new Error('already_active');

  const endsAt = ds ? new Date(Date.now() + ds * 1000).toISOString() : null;

  const row = db.insertGiveaway({
    streamer_id: streamerId,
    keyword: normalizedKeyword,
    prize: prize || null,
    status: 'open',
    subs_only: subsOnly ? 1 : 0,
    duration_seconds: ds,
    winners_count: wc,
    ends_at: endsAt,
  });

  _track(row);

  // Chat announcement — best effort, never throws
  try {
    const { chatManager } = require('./twitchChat');
    const streamer = db.getStreamerById(streamerId);
    if (streamer && streamer.chatbot_enabled && streamer.twitch_username) {
      const prizeText = row.prize ? ` — Prize: ${row.prize}` : '';
      chatManager.sendRawMessage(
        streamer.twitch_username,
        `\u{1F381} Giveaway started! Type !${normalizedKeyword} to enter${prizeText}`
      );
    }
  } catch (e) {
    console.error('[Giveaway] chat announce error:', e.message);
  }

  return row;
}

// Synchronous fast path — no async work, called per chat message
function tryAddEntry(streamerId, tags, message) {
  const state = activeStates.get(streamerId);
  if (!state) return false;

  const firstWord = message.trim().split(/\s+/)[0].toLowerCase();
  if (firstWord !== '!' + state.keyword) return false;

  if (state.subsOnly) {
    // tmi.js exposes subscriber as a string '1'/'0' or boolean depending on version
    const isSub = tags.subscriber === true || tags.subscriber === '1' || tags.subscriber === 1;
    const isMod = tags.mod === true || tags.mod === '1' || tags.mod === 1;
    const isBroadcaster = !!(tags.badges && tags.badges.broadcaster);
    if (!isSub && !isMod && !isBroadcaster) return false;
  }

  try {
    db.insertEntry({
      giveaway_id: state.giveawayId,
      twitch_user_id: tags['user-id'] || tags.userId || '',
      username: tags['display-name'] || tags.username || 'unknown',
      is_subscriber: (tags.subscriber === true || tags.subscriber === '1' || tags.subscriber === 1) ? 1 : 0,
    });
  } catch (e) {
    // UNIQUE constraint violations are handled by INSERT OR IGNORE; log anything unexpected
    if (!/unique/i.test(String(e.message))) {
      console.error('[Giveaway] insertEntry error:', e.message);
    }
  }

  // Return true even for duplicate entries — keyword is still owned by the giveaway
  return true;
}

function closeGiveaway(streamerId, opts) {
  const silent = opts && opts.silent;
  const state = activeStates.get(streamerId);
  if (!state) return null;

  if (state.watchdogTimer) {
    clearTimeout(state.watchdogTimer);
    state.watchdogTimer = null;
  }

  db.closeGiveaway(state.giveawayId, streamerId);
  activeStates.delete(streamerId);

  if (!silent) {
    try {
      const { chatManager } = require('./twitchChat');
      const streamer = db.getStreamerById(streamerId);
      if (streamer && streamer.chatbot_enabled && streamer.twitch_username) {
        chatManager.sendRawMessage(streamer.twitch_username, '\u{1F381} Giveaway closed!');
      }
    } catch (e) {
      console.error('[Giveaway] chat close error:', e.message);
    }
  }

  const giveaway = db.getGiveawayById(state.giveawayId, streamerId);
  const entryCount = db.getEntryCount(state.giveawayId);
  return { giveaway, entryCount };
}

function pickWinners(giveawayId, streamerId, opts) {
  const redraw = opts && opts.redraw;

  const giveaway = db.getGiveawayById(giveawayId, streamerId);
  if (!giveaway) return { winners: [], error: 'not_found' };

  // Auto-close if caller forgot to close first
  if (giveaway.status === 'open') {
    closeGiveaway(streamerId, { silent: true });
  }

  const selected = db.transaction(() => {
    if (redraw) {
      // Mark prior winners as redrawn-out so they're excluded from this draw
      const priorWinners = db.getWinners(giveawayId);
      if (priorWinners.length > 0) {
        db.markRedrawnOut(giveawayId, priorWinners.map(w => w.id));
      }
    }

    const eligible = db.getEligibleEntries(giveawayId);
    if (eligible.length === 0) return [];

    const count = Math.min(giveaway.winners_count || 1, eligible.length);

    // Fisher-Yates shuffle using crypto.randomInt for uniform distribution
    const pool = eligible.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const winners = pool.slice(0, count);
    db.markWinners(giveawayId, winners.map(e => e.id));
    return winners;
  })();

  if (selected.length === 0) return { winners: [] };

  // Post chat messages + emit overlay events, staggered 1500ms per winner
  const prize = giveaway.prize || null;
  selected.forEach((w, index) => {
    const delay = index * 1500;

    const chatTimer = setTimeout(() => {
      try {
        const { chatManager } = require('./twitchChat');
        const streamer = db.getStreamerById(streamerId);
        if (streamer && streamer.chatbot_enabled && streamer.twitch_username) {
          const prizeText = prize ? ` You won ${prize}!` : ' You won the giveaway!';
          chatManager.sendRawMessage(
            streamer.twitch_username,
            `\u{1F389} Congrats @${w.username}!${prizeText}`
          );
        }
      } catch (e) {
        console.error('[Giveaway] chat winner error:', e.message);
      }
    }, delay);
    chatTimer.unref();

    const overlayTimer = setTimeout(() => {
      try {
        const bus = require('./overlayBus');
        bus.emit(`overlay:${streamerId}`, {
          type: 'giveaway_winner',
          data: {
            username: w.username,
            prize: prize,
            keyword: giveaway.keyword,
          },
        });
      } catch (e) {
        console.error('[Giveaway] overlay emit error:', e.message);
      }
    }, delay);
    overlayTimer.unref();
  });

  return {
    winners: selected.map(w => ({ id: w.id, username: w.username, twitch_user_id: w.twitch_user_id })),
  };
}

function getActive(streamerId) {
  return activeStates.get(streamerId) || null;
}

// ── Internal helpers ─────────────────────────────────────────────────

function _track(row) {
  const entry = {
    giveawayId: row.id,
    keyword: row.keyword,
    subsOnly: !!row.subs_only,
    winnersCount: row.winners_count || 1,
    prize: row.prize || null,
    watchdogTimer: null,
  };

  if (row.ends_at) {
    const msLeft = Math.max(0, new Date(row.ends_at).getTime() - Date.now());
    const timer = setTimeout(() => _autoEnd(row.streamer_id), msLeft);
    timer.unref();
    entry.watchdogTimer = timer;
  }

  activeStates.set(row.streamer_id, entry);
}

function _autoEnd(streamerId) {
  try {
    closeGiveaway(streamerId, { silent: false });
    // Fetch the giveaway that was just closed to pick from it
    const history = db.getGiveawaysHistory(streamerId, 1);
    if (history.length > 0) {
      const g = history[0];
      const entryCount = db.getEntryCount(g.id);
      if (entryCount > 0) {
        pickWinners(g.id, streamerId, {});
      }
    }
  } catch (e) {
    console.error('[Giveaway] _autoEnd error for streamer', streamerId, ':', e.message);
  }
}

module.exports = { init, startGiveaway, tryAddEntry, closeGiveaway, pickWinners, getActive };
