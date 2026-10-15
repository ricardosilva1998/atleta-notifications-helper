'use strict';

// The poll and the prediction running on each streamer's channel, as the Polls & predictions card, the on-stream bar
// and the bot see them. Twitch tells this module about them three ways: EventSub's seven poll and prediction events
// (onEvent), Twitch's answer to the card's own buttons (setFromTwitch), and a read of Twitch when the card or the bar
// asks (live) — while EventSub said nothing in the last 30 seconds, or while a running poll or prediction is past its
// end (its end or lock event is late) — at most one every 5 seconds per streamer. A late or repeated message never
// takes a poll back: an ended poll stays ended, and an earlier poll never replaces a later one. Every change goes on
// the bus channel `poll:<streamerId>` for the bar (never `overlay:<id>`: the alert overlay would queue it as a card).
// The bot announces a start, a lock and an end once per poll or prediction — never what a read finds — with the
// streamer's texts while their announcements are on (chatManager.sendMessage checks the chatbot switch). A streamer is
// known by their id as a number, whether it is given as a number or as text.

const rules = require('./pollRules');
const { fillChatTemplate } = require('./chatTemplate');
const bus = require('./overlayBus');

const READ_EVERY_MS = 5000;
const EVENT_FRESH_MS = 30000;
const FORGET_AFTER_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
const ANNOUNCED_KEPT = 50; // the moments remembered per streamer, so a repeat is not announced twice
const RANK = Object.freeze({ running: 0, locked: 1, ended: 2 });

// What each EventSub type is about, and the moment the bot announces (null: none).
const EVENTS = Object.freeze({
  'channel.poll.begin': ['poll', 'start'],
  'channel.poll.progress': ['poll', null],
  'channel.poll.end': ['poll', 'end'],
  'channel.prediction.begin': ['prediction', 'start'],
  'channel.prediction.progress': ['prediction', null],
  'channel.prediction.lock': ['prediction', 'lock'],
  'channel.prediction.end': ['prediction', 'end'],
});

const normalize = (kind, src, now) => (kind === 'poll' ? rules.normalizePoll(src, now) : rules.normalizePrediction(src, now));

// A refusal twitchPolls throws (a PollsError): an error whose code the card has a text for (pollRules.ERRORS). It is
// told apart by its code, not its class: twitchPolls loads the app's config, which this file's unit tests do without.
const isRefusal = (err) => !!err && typeof err.code === 'string' && Object.prototype.hasOwnProperty.call(rules.ERRORS, err.code);

// A running poll or prediction whose time is up: Twitch has ended or locked it, so its event is late.
const overdue = (view, t) => !!view && view.state === 'running' && view.endsAt !== null && t >= view.endsAt;

function createLivePolls({ emit, send, getStreamer, fetchLatest, now = Date.now }) {
  // streamerId (a number) → { poll, prediction, eventAt, readAt, reading, refusal, failing, announced, touchedAt }
  const streamers = new Map();

  function entry(streamerId) {
    let e = streamers.get(streamerId);
    if (!e) {
      e = {
        poll: null, prediction: null, eventAt: 0, readAt: 0, reading: null, refusal: null, failing: false,
        announced: new Set(), touchedAt: now(),
      };
      streamers.set(streamerId, e);
    }
    return e;
  }

  // 'stale' when `view` is older news than what is stored for its kind; 'same' when it changes nothing; else
  // 'changed', and it is stored.
  function store(e, view) {
    const old = e[view.kind];
    if (old && old.id === view.id && RANK[view.state] < RANK[old.state]) return 'stale';
    if (old && old.id !== view.id && old.startedAt !== null && view.startedAt !== null && view.startedAt < old.startedAt) return 'stale';
    e.touchedAt = now();
    if (old && JSON.stringify(old) === JSON.stringify(view)) return 'same';
    e[view.kind] = view;
    return 'changed';
  }

  function barState(streamerId) {
    const e = streamers.get(Number(streamerId));
    return { poll: e ? e.poll : null, prediction: e ? e.prediction : null, serverNow: now() };
  }

  function announce(streamerId, e, view, phase) {
    const key = `${view.kind}:${view.id}:${phase}`;
    if (e.announced.has(key)) return;
    e.announced.add(key);
    if (e.announced.size > ANNOUNCED_KEPT) e.announced.delete(e.announced.values().next().value);
    const streamer = getStreamer(streamerId);
    if (!streamer || !streamer.polls_chat_enabled) return;
    const line = rules.announcement(view, phase, now());
    if (!line) return;
    const text = fillChatTemplate(streamer[line.textKey], line.values);
    if (text) send(streamerId, text);
  }

  // One poll or prediction as Twitch described it; `phase` is the moment to announce, or null.
  function take(streamerId, kind, src, phase) {
    const view = normalize(kind, src, now());
    if (!view) return null;
    const e = entry(streamerId);
    const result = store(e, view);
    if (result === 'stale') return e[kind];
    if (result === 'changed') emit(`poll:${streamerId}`, { type: 'poll-state', ...barState(streamerId) });
    if (phase) announce(streamerId, e, view, phase);
    return view;
  }

  // An EventSub notification of one of the seven poll and prediction types.
  function onEvent(streamerId, subscriptionType, event) {
    const what = EVENTS[subscriptionType];
    if (!what) return;
    const id = Number(streamerId);
    entry(id).eventAt = now();
    take(id, what[0], event, what[1]);
  }

  // Twitch's answer to one of the card's buttons: shown at once, and announced once even when EventSub reports the
  // same moment a little later.
  function setFromTwitch(streamerId, kind, twitchObject, phase) {
    return take(Number(streamerId), kind, twitchObject, phase || null);
  }

  // What the card shows: running, locked, or a result for 30 seconds.
  function snapshot(streamerId) {
    const e = streamers.get(Number(streamerId));
    const t = now();
    return {
      poll: e && rules.onCard(e.poll, t) ? e.poll : null,
      prediction: e && rules.onCard(e.prediction, t) ? e.prediction : null,
      serverNow: t,
    };
  }

  // One read of Twitch, shared by the callers that come while it runs. It resolves with the refusal to pass on
  // (needs_reconnect) or null, and never rejects: anything else that goes wrong keeps what is known and is logged —
  // Twitch's other refusals once until a read works (a card asks every few seconds), anything else with its stack.
  async function read(streamerId, e) {
    // The rest runs once e.reading holds this read: a throw before the first wait (getStreamer) would otherwise settle
    // the read before it is stored, and the streamer would never be read again.
    await null;
    let refusal = null;
    try {
      const latest = await fetchLatest(getStreamer(streamerId));
      e.failing = false;
      take(streamerId, 'poll', latest && latest.poll, null);
      take(streamerId, 'prediction', latest && latest.prediction, null);
    } catch (err) {
      if (!isRefusal(err)) {
        console.error(`[Polls] Reading Twitch's poll and prediction failed for streamer ${streamerId}:`, err);
      } else if (err.code === 'needs_reconnect') {
        refusal = err;
      } else if (!e.failing) {
        e.failing = true;
        console.warn(`[Polls] Twitch's poll and prediction could not be read for streamer ${streamerId}: ${err.message}`);
      }
    } finally {
      e.readAt = now();
      e.refusal = refusal;
      e.reading = null;
    }
    return refusal;
  }

  // The card's view, after reading Twitch when EventSub said nothing in the last 30 seconds (a poll started on
  // Twitch's own dashboard or by a moderator shows without EventSub) or when a running poll or prediction is past its
  // end (its end or lock event is late: the result still reaches the card and the bar), at most once every 5 seconds.
  // What a read finds is never announced. A read that fails keeps what is known; a missing permission
  // (needs_reconnect) is passed on to every caller until the next read, 5 seconds later.
  async function live(streamerId) {
    const id = Number(streamerId);
    const e = entry(id);
    const t = now();
    if (t - e.readAt < READ_EVERY_MS) {
      if (e.refusal) throw e.refusal;
      return snapshot(id);
    }
    const late = overdue(e.poll, t) || overdue(e.prediction, t);
    if (t - e.eventAt < EVENT_FRESH_MS && !late) return snapshot(id);
    if (!e.reading) e.reading = read(id, e);
    const refusal = await e.reading;
    if (refusal) throw refusal;
    return snapshot(id);
  }

  // Forgets a streamer with nothing running and no change in the last hour.
  function sweep() {
    const t = now();
    for (const [streamerId, e] of streamers) {
      const busy = [e.poll, e.prediction].some((view) => view && view.state !== 'ended');
      if (!busy && !e.reading && t - e.touchedAt > FORGET_AFTER_MS) streamers.delete(streamerId);
    }
  }

  return { onEvent, setFromTwitch, snapshot, barState, live, sweep };
}

// The app's instance. The chat bot, the database and twitchPolls are required when first used: they load the app's
// config, which this file's unit tests do without.
const livePolls = createLivePolls({
  emit: (channel, payload) => bus.emit(channel, payload),
  send: (streamerId, text) => require('./twitchChat').chatManager.sendMessage(streamerId, text, { priority: 'normal' }),
  getStreamer: (streamerId) => require('../db').getStreamerById(streamerId),
  fetchLatest: async (streamer) => {
    const twitchPolls = require('./twitchPolls');
    const [poll, prediction] = await Promise.all([twitchPolls.latestPoll(streamer), twitchPolls.latestPrediction(streamer)]);
    return { poll, prediction };
  },
});
setInterval(() => livePolls.sweep(), SWEEP_EVERY_MS).unref();

module.exports = { createLivePolls, livePolls, READ_EVERY_MS, EVENT_FRESH_MS };
