'use strict';

// The six trackers — small OBS sources that each show one last value: the latest follower, sub, tip, raid and bits,
// and the top tipper of the stream. Each streamer's trackers are told about changes on their own bus channel,
// `tracker:<streamerId>` (never `overlay:<id>`: the alert overlay would queue it as a card), as
// { type: 'tracker', tracker, value }.
//
// The five "latest" values are stored (tracker_values, as JSON text), so a source shows the last one after a restart
// or a reload. They are written by the Twitch events EventSub turns into alerts (onEvent, called after the event is
// logged) and by tips once db.logDonation() wrote a new row (onTip: a replayed tip never gets here). Every value is
// stored and broadcast whether its tracker is switched on or not; a source that is switched off hides itself.
//
// The top tipper is worked out, never stored: the donor who gave the most in the tip page's currency
// (donation_currency) since the stream started — the channel_state of the streamer's linked login, which the live
// poller keeps for every enabled streamer's own channel: while live its stream_started_at, once it is over the last
// stream's start (last_stream_started_at, kept until the next stream starts) — else over the last 12 hours. Names are
// grouped whatever their case and "Anonymous" is left out; other currencies are never added in. When the poller sees
// the stream start, the open sources are told at once (streamStarted, from pollers/manager.js).
//
// Linking another Twitch account clears the stored values (clear(), from accountLifecycle.twitchAccountChanged).
//
// The database is handed in (createTrackers), so the unit tests run this on an in-memory database with a clock of
// their own; the app's instance requires it when first used.

const bus = require('./overlayBus');

const TRACKERS = ['latest_follower', 'latest_sub', 'latest_tip', 'latest_raid', 'latest_bits', 'top_tipper'];
const DEFAULT_COLOR = '#9146FF'; // a tracker with no colour of its own: the Atleta purple
const NAME_MAX = 100;
const NO_STREAM_WINDOW_MS = 12 * 60 * 60 * 1000;
const TEST_REVERT_MS = 10000; // a test's sample stays this long, then the real value comes back

function channel(streamerId) {
  return `tracker:${streamerId}`;
}

const round2 = (n) => Math.round(n * 100) / 100;
const nameOf = (value) => (value == null ? '' : String(value).slice(0, NAME_MAX));
const numberOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// What an EventSub event (as eventsub.js normalizes it for the alerts) sets: [tracker, value], or null.
function valueOfEvent(normalized) {
  if (!normalized || !normalized.data) return null;
  const d = normalized.data;
  switch (normalized.type) {
    case 'follow': return ['latest_follower', { name: nameOf(d.username) }];
    case 'subscription': return ['latest_sub', { name: nameOf(d.username), months: Math.max(1, Math.floor(numberOf(d.months)) || 1), tier: String(d.tier || '1') }];
    case 'giftsub': return ['latest_sub', { name: nameOf(d.username), gifted: Math.max(1, Math.floor(numberOf(d.amount)) || 1) }];
    case 'bits': return ['latest_bits', { name: nameOf(d.username), amount: numberOf(d.amount) }];
    case 'raid': return ['latest_raid', { name: nameOf(d.username), viewers: numberOf(d.viewers) }];
    default: return null;
  }
}

// What a tip (db.logDonation()'s new row, or a stored donations row) sets as the latest tip, in any currency.
function valueOfTip(tip) {
  const t = tip || {};
  return {
    name: nameOf(t.name) || 'Anonymous',
    amount: round2(numberOf(t.amount)),
    currency: t.currency ? String(t.currency).toUpperCase() : null,
  };
}

// What a test shows on a tracker's source (the Tracking card's ▶): the sample viewer `name`, with the tip trackers'
// amounts in `currency` (the tip page's). null for a tracker that does not exist.
function sampleValue(tracker, { name, currency } = {}) {
  switch (tracker) {
    case 'latest_follower': return { name };
    case 'latest_sub': return { name, months: 6, tier: '1' };
    case 'latest_tip': return { name, amount: 10, currency };
    case 'latest_raid': return { name, viewers: 42 };
    case 'latest_bits': return { name, amount: 500 };
    case 'top_tipper': return { name, amount: 25, currency };
    default: return null;
  }
}

function createTrackers({ db, emit, now = Date.now, logger = console, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const testTimers = new Map(); // `${streamerId}:${tracker}` → the timer that brings the real value back
  function broadcast(streamerId, tracker, value) {
    emit(channel(streamerId), { type: 'tracker', tracker, value });
  }

  function store(streamerId, tracker, value) {
    db.setTrackerValue(streamerId, tracker, value);
    broadcast(streamerId, tracker, value);
  }

  // When this stream started: the linked channel's stream_started_at while live, else its last stream's start, else
  // 12 hours ago. Reads channel_state without writing a row (db.getChannelState would add one).
  function streamStart(streamer) {
    const login = streamer.twitch_username ? String(streamer.twitch_username).toLowerCase() : '';
    const state = login ? db.findChannelState(login) : null;
    const value = !state ? null : (state.is_live
      ? state.stream_started_at || state.last_stream_started_at
      : state.last_stream_started_at || state.stream_started_at);
    const started = value ? Date.parse(value) : NaN;
    return Number.isFinite(started) ? new Date(started) : new Date(now() - NO_STREAM_WINDOW_MS);
  }

  // { name, amount, currency } of the stream's top tipper, or null (nobody yet, or no such streamer).
  function topTipper(streamerId) {
    const streamer = db.getStreamerById(streamerId);
    if (!streamer) return null;
    const currency = String(streamer.donation_currency || 'EUR').toUpperCase();
    const top = db.getTopTipper(streamerId, currency, streamStart(streamer));
    return top ? { name: top.name, amount: round2(top.amount), currency } : null;
  }

  // A Twitch event the alerts got (follow, subscription, giftsub, bits, raid); anything else is left alone. Never throws.
  function onEvent(streamerId, normalized) {
    try {
      const set = valueOfEvent(normalized);
      if (set) store(streamerId, set[0], set[1]);
    } catch (err) {
      logger.error('[Trackers] onEvent error:', err.message);
    }
  }

  // A tip that db.logDonation() just recorded (PayPal or StreamElements), in any currency: the latest tip, then the
  // top tipper as it stands now. Never throws.
  function onTip(streamerId, tip) {
    try {
      store(streamerId, 'latest_tip', valueOfTip(tip));
      broadcast(streamerId, 'top_tipper', topTipper(streamerId));
    } catch (err) {
      logger.error('[Trackers] onTip error:', err.message);
    }
  }

  // The live poller saw this login's stream start (a new broadcast, or another one replacing it): the top tipper of
  // every enabled streamer linked to it starts over, so a source opened before the stream does not keep showing the
  // last stream's donor until the first tip. Never throws.
  function streamStarted(login) {
    try {
      for (const streamerId of db.getEnabledStreamerIdsByTwitchLogin(login)) broadcast(streamerId, 'top_tipper', topTipper(streamerId));
    } catch (err) {
      logger.error('[Trackers] streamStarted error:', err.message);
    }
  }

  // Removes the streamer's stored values and tells the open sources (the five stored ones empty, the top tipper as it
  // stands now), so nothing shows another channel's numbers after the linked Twitch account changed.
  function clear(streamerId) {
    db.clearTrackerValues(streamerId);
    for (const tracker of TRACKERS) broadcast(streamerId, tracker, tracker === 'top_tipper' ? topTipper(streamerId) : null);
  }

  // A test (the Tracking card's ▶): the source shows a sample for TEST_REVERT_MS, then the real value again. Nothing is
  // stored; a test of the same tracker during those seconds starts them over. Returns the message the source got, or
  // null for a tracker that does not exist.
  function sendTest(streamerId, tracker, { name } = {}) {
    if (!TRACKERS.includes(tracker)) return null;
    const streamer = db.getStreamerById(streamerId);
    const currency = String((streamer && streamer.donation_currency) || 'EUR').toUpperCase();
    const message = { type: 'tracker', tracker, value: sampleValue(tracker, { name: nameOf(name), currency }), test: true };
    emit(channel(streamerId), message);
    const key = `${streamerId}:${tracker}`;
    clearTimer(testTimers.get(key));
    const timer = setTimer(() => {
      testTimers.delete(key);
      try {
        broadcast(streamerId, tracker, valueOf(streamerId, tracker));
      } catch (err) {
        logger.error('[Trackers] test revert error:', err.message);
      }
    }, TEST_REVERT_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    testTimers.set(key, timer);
    return message;
  }

  // A stored value read back: null when none, or one that cannot be read.
  function parsed(text) {
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // Every tracker's value, in TRACKERS order: the stored ones read back and the top tipper worked out now.
  function values(streamerId) {
    const stored = db.getTrackerValues(streamerId);
    const out = {};
    for (const tracker of TRACKERS) out[tracker] = tracker === 'top_tipper' ? topTipper(streamerId) : parsed(stored[tracker]);
    return out;
  }

  // One tracker's value, as values() gives it, working out only that one (the top tipper only when asked for);
  // null for a tracker that does not exist.
  function valueOf(streamerId, tracker) {
    if (!TRACKERS.includes(tracker)) return null;
    if (tracker === 'top_tipper') return topTipper(streamerId);
    return parsed(db.getTrackerValues(streamerId)[tracker]);
  }

  // Every tracker's settings, in TRACKERS order, as its source draws them: { enabled, color, ownColor }. A tracker
  // with no row is on; a colour that is not #rrggbb (or none) is DEFAULT_COLOR, and ownColor says one is stored.
  function settings(streamerId) {
    const rows = db.getTrackerSettings(streamerId);
    const out = {};
    for (const tracker of TRACKERS) {
      const row = rows[tracker];
      const own = !!row && typeof row.color === 'string' && /^#[0-9a-f]{6}$/i.test(row.color);
      out[tracker] = { enabled: row ? !!row.enabled : true, color: own ? row.color : DEFAULT_COLOR, ownColor: own };
    }
    return out;
  }

  return { onEvent, onTip, streamStarted, topTipper, clear, values, valueOf, settings, sendTest };
}

// The app's instance. The database is required when first used: it loads the app's config, which this file's unit
// tests do without.
let app = null;
function instance() {
  if (!app) {
    app = createTrackers({
      db: require('../db'),
      emit: (name, payload) => bus.emit(name, payload),
    });
  }
  return app;
}

module.exports = {
  TRACKERS,
  DEFAULT_COLOR,
  TEST_REVERT_MS,
  channel,
  sampleValue,
  valueOfEvent,
  valueOfTip,
  createTrackers,
  onEvent: (...args) => instance().onEvent(...args),
  onTip: (...args) => instance().onTip(...args),
  streamStarted: (...args) => instance().streamStarted(...args),
  topTipper: (...args) => instance().topTipper(...args),
  clear: (...args) => instance().clear(...args),
  values: (...args) => instance().values(...args),
  valueOf: (...args) => instance().valueOf(...args),
  settings: (...args) => instance().settings(...args),
  sendTest: (...args) => instance().sendTest(...args),
};
