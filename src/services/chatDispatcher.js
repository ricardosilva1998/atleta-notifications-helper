'use strict';

// Every line the shared Twitch bot posts goes out through one dispatcher
// (twitchChat.js keeps it). Twitch lets an account post about 20 messages in
// any 30 seconds, counted across all the channels it posts in, and drops what
// goes over, so one busy chat could get the bot muted for every streamer.
//  - The bot spends one of 20 tokens per message, and a token comes back 30 s
//    after it was spent, so no 30 s window ever holds more than 20 messages (a
//    bucket that refills a little at a time would let up to 40 through in the
//    first 30 s). BOT_CHAT_RATE_LIMIT changes the 20 (config.js).
//  - Two messages in the same channel are at least 1.5 s apart.
//  - Waiting messages of a channel go out most important first: moderation
//    notices and command replies, then event thank-yous, then sponsor and timed
//    messages; oldest first within each. When the bot-wide limit is what holds
//    them, the channel that posted least recently goes next, so one busy chat
//    cannot hold up the bot for the other streamers; a sponsor or timed message
//    gets a turn only when no other message is ready in any channel.
//  - A thank-you that can be merged waits 5 s, and thank-yous of the same kind
//    in the same channel that arrive while it waits join it ("Welcome to the pit
//    crew, A, B and C!") as long as the line stays short enough.
//  - A sponsor or timed message that has waited more than 60 s is dropped, and
//    at most 20 messages wait per channel.
//  - While the bot has no connection to Twitch (isReady() says false: it is
//    connecting or reconnecting) nothing is sent, because a line sent then is
//    lost and would still use up one of the 20. Lines wait for the connection
//    instead, and are looked for every second; one that has waited more than
//    60 s is dropped, whatever it is.
//  - Every line is cleaned (chatLine): one line, trimmed, and short enough for
//    tmi.js to send as one message (an action line, "/me ...", a little shorter).
// The clock and the timer functions can be passed in, for tests. The timer is
// unref'd, so a waiting message never keeps the process alive.

const { performance } = require('perf_hooks');
const { singleLine } = require('./chatCommands');

const PRIORITY = Object.freeze({ high: 0, normal: 1, low: 2 });

// tmi.js (1.8.5, client._sendMessage) splits a message of 500 or more UTF-16
// units into two chat messages, the second outside this dispatcher. Twitch takes
// 500 characters, so one line is at most 499 units.
const MAX_CHAT_LINE = 499;
// tmi.js say() sends a line starting "/me " (or ".me ", "\me ") as the action
// "\u0001ACTION ...\u0001", which is 5 units longer, so such a line is at most 494.
const ACTION_LINE = /^[/.\\]me /;
const MAX_ACTION_LINE = MAX_CHAT_LINE - 5;

function lineLimit(line) {
  return ACTION_LINE.test(line) ? MAX_ACTION_LINE : MAX_CHAT_LINE;
}

const DEFAULTS = Object.freeze({
  maxMessages: 20, // per windowMs, across all channels
  windowMs: 30_000,
  channelGapMs: 1_500,
  mergeWindowMs: 5_000,
  lowPriorityMaxAgeMs: 60_000,
  heldMaxAgeMs: 60_000, // the longest any line waits for a connection that is down
  notReadyRecheckMs: 1_000, // how often a down connection is looked at again while lines wait
  maxWaitingPerChannel: 20,
  dropLogIntervalMs: 60_000, // at most one "dropped" log line per channel this often
});

// One chat line: control characters (line breaks included) become spaces, the
// ends are trimmed, and the text is cut to its limit (lineLimit) without
// splitting an emoji's surrogate pair.
function chatLine(text) {
  let line = singleLine(text ?? '');
  const limit = lineLimit(line);
  if (line.length > limit) {
    let end = limit;
    const last = line.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    line = line.slice(0, end).trimEnd();
  }
  return line;
}

// "#SomeChannel" and "somechannel" are the same channel.
function channelKey(channel) {
  return String(channel ?? '').trim().replace(/^#/, '').toLowerCase();
}

function defaultSetTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}

// options: send(channel, line) (returns a promise, or throws), and optionally
// isReady() (false while there is no connection to send on; a check that throws
// counts as connected), now, setTimer, clearTimer, log and any of DEFAULTS.
function createChatDispatcher(options = {}) {
  const { send } = options;
  if (typeof send !== 'function') throw new TypeError('createChatDispatcher needs a send function');
  const now = options.now || (() => performance.now());
  const setTimer = options.setTimer || defaultSetTimer;
  const clearTimer = options.clearTimer || clearTimeout;
  const log = options.log || console;
  // A line is never held back for good because the check itself failed.
  const connected = typeof options.isReady === 'function'
    ? () => { try { return Boolean(options.isReady()); } catch (err) { return true; } }
    : () => true;

  const limits = { ...DEFAULTS };
  for (const name of Object.keys(DEFAULTS)) {
    const value = Number(options[name]);
    if (options[name] != null && Number.isFinite(value) && value >= 0) limits[name] = value;
  }
  limits.maxMessages = Math.max(1, Math.floor(limits.maxMessages));
  limits.maxWaitingPerChannel = Math.max(1, Math.floor(limits.maxWaitingPerChannel));

  const spentAt = []; // when each token in use was spent, oldest first
  const waiting = []; // messages not sent yet
  const channels = new Map(); // channel key -> { lastSentAt, dropped, dropReason, droppedLoggedAt }
  let timer = null;
  let nextSeq = 0;

  function stateOf(key) {
    let state = channels.get(key);
    if (!state) {
      state = { lastSentAt: undefined, dropped: 0, dropReason: '', droppedLoggedAt: undefined };
      channels.set(key, state);
    }
    return state;
  }

  function reportDrops(key, state, t) {
    log.warn(`[Chat] Dropped ${state.dropped} waiting message(s) for ${key}: ${state.dropReason}`);
    state.dropped = 0;
    state.droppedLoggedAt = t;
  }

  // Counted at once, logged at most once per dropLogIntervalMs per channel: drops
  // within that minute are reported with the next line, or by prune once it is over.
  function noteDrop(entry, t, reason) {
    const state = stateOf(entry.key);
    state.dropped += 1;
    state.dropReason = reason;
    if (state.droppedLoggedAt !== undefined && t - state.droppedLoggedAt < limits.dropLogIntervalMs) return;
    reportDrops(entry.key, state, t);
  }

  function deliver(entry) {
    const failed = (err) => log.error(`[Chat] Failed to send to ${entry.key}: ${err && err.message ? err.message : err}`);
    try {
      const result = send(entry.channel, entry.line);
      if (result && typeof result.catch === 'function') result.catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  function dropStale(t, up) {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const entry = waiting[i];
      if (entry.rank === PRIORITY.low && t - entry.createdAt > limits.lowPriorityMaxAgeMs) {
        waiting.splice(i, 1);
        noteDrop(entry, t, `waited over ${Math.round(limits.lowPriorityMaxAgeMs / 1000)} s`);
      } else if (!up && t - entry.createdAt > limits.heldMaxAgeMs) {
        waiting.splice(i, 1);
        noteDrop(entry, t, `waited over ${Math.round(limits.heldMaxAgeMs / 1000)} s for the connection to Twitch`);
      }
    }
  }

  // When the entry's channel may post again.
  function channelFreeAt(entry) {
    const last = channels.get(entry.key)?.lastSentAt;
    return last === undefined ? -Infinity : last + limits.channelGapMs;
  }

  // The message to send now. Among the moderation, command and thank-you lines
  // whose channel may post: the channel that posted least recently, then the
  // most important, then the oldest. A sponsor or timed line (same order) only
  // when none of those is ready in any channel.
  function nextReady(t) {
    return readiest(t, (entry) => entry.rank !== PRIORITY.low) || readiest(t, (entry) => entry.rank === PRIORITY.low);
  }

  function readiest(t, wanted) {
    let best = null;
    let bestLast = 0;
    for (const entry of waiting) {
      if (!wanted(entry) || entry.notBefore > t || channelFreeAt(entry) > t) continue;
      const last = channels.get(entry.key)?.lastSentAt ?? -Infinity;
      if (!best || last < bestLast
        || (last === bestLast && (entry.rank < best.rank || (entry.rank === best.rank && entry.seq < best.seq)))) {
        best = entry;
        bestLast = last;
      }
    }
    return best;
  }

  // A channel's state goes once nothing waits for it and nothing in it is recent:
  // its last send is remembered for the whole rate window, so the channel that
  // posted least recently is still known when the bot-wide limit decides. Drops
  // not reported yet keep it, and are reported here once their minute is over.
  function prune(t) {
    const remember = Math.max(limits.windowMs, limits.channelGapMs);
    for (const [key, state] of channels) {
      if (state.dropped > 0 && t - state.droppedLoggedAt >= limits.dropLogIntervalMs) reportDrops(key, state, t);
      if (state.dropped > 0 || waiting.some((entry) => entry.key === key)) continue;
      const recentSend = state.lastSentAt !== undefined && t - state.lastSentAt < remember;
      const recentDropLog = state.droppedLoggedAt !== undefined && t - state.droppedLoggedAt < limits.dropLogIntervalMs;
      if (!recentSend && !recentDropLog) channels.delete(key);
    }
  }

  function stopTimer() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function schedule(t, up) {
    stopTimer();
    if (!waiting.length) return;
    if (!up) {
      // Nothing can go until the connection is back: look again soon (this also
      // lets lines that have waited too long go).
      timer = setTimer(pump, Math.max(1, limits.notReadyRecheckMs));
      return;
    }
    let at = Infinity;
    for (const entry of waiting) at = Math.min(at, Math.max(entry.notBefore, channelFreeAt(entry)));
    if (spentAt.length >= limits.maxMessages) at = Math.max(at, spentAt[0] + limits.windowMs);
    timer = setTimer(pump, Math.max(1, Math.ceil(at - t)));
  }

  // Sends what may go now, then sets one timer for the next moment anything can.
  function pump() {
    stopTimer();
    for (;;) {
      const t = now();
      const up = connected();
      while (spentAt.length && t - spentAt[0] >= limits.windowMs) spentAt.shift();
      dropStale(t, up);
      const entry = up && spentAt.length < limits.maxMessages ? nextReady(t) : null;
      if (!entry) {
        prune(t);
        schedule(t, up);
        return;
      }
      waiting.splice(waiting.indexOf(entry), 1);
      spentAt.push(t);
      stateOf(entry.key).lastSentAt = t;
      deliver(entry);
    }
  }

  // Adds a name to a waiting thank-you if the line still fits. True when the
  // name is in it (also when it already was).
  function mergeInto(entry, name) {
    const same = String(name).toLowerCase();
    if (entry.merge.names.some((n) => String(n).toLowerCase() === same)) return true;
    const names = [...entry.merge.names, name];
    const line = singleLine(entry.merge.render(names) ?? '');
    if (!line || line.length > lineLimit(line)) return false;
    entry.merge.names = names;
    entry.line = line;
    return true;
  }

  // At most maxWaitingPerChannel messages wait per channel: a new message takes
  // the place of the oldest waiting message of a lower priority, or is dropped.
  function makeRoom(entry, t) {
    const sameChannel = waiting.filter((e) => e.key === entry.key);
    if (sameChannel.length < limits.maxWaitingPerChannel) return true;
    let victim = null;
    for (const e of sameChannel) {
      if (e.rank <= entry.rank) continue;
      if (!victim || e.rank > victim.rank || (e.rank === victim.rank && e.seq < victim.seq)) victim = e;
    }
    if (!victim) {
      noteDrop(entry, t, 'queue full');
      return false;
    }
    waiting.splice(waiting.indexOf(victim), 1);
    noteDrop(victim, t, 'queue full');
    return true;
  }

  // message: { channel, text, priority: 'high' | 'normal' | 'low', merge }
  // merge (thank-yous that may share a line): { key, name, render(names) -> text };
  // the text is then render([name]). render must return the whole line, never
  // one cut to a length: a name is added only when the whole line still fits.
  // Returns 'sent', 'queued', 'merged' or 'dropped'.
  function enqueue(message = {}) {
    const { channel, priority, merge } = message;
    const key = channelKey(channel);
    if (!key) return 'dropped';
    const rank = Object.prototype.hasOwnProperty.call(PRIORITY, priority) ? PRIORITY[priority] : PRIORITY.normal;
    const t = now();

    if (merge) {
      // Any waiting line of the same kind in this channel that still has room.
      for (const open of waiting) {
        if (open.key === key && open.merge && open.merge.key === merge.key && mergeInto(open, merge.name)) return 'merged';
      }
    }
    const line = chatLine(merge ? merge.render([merge.name]) : message.text);
    if (!line) return 'dropped';

    const entry = {
      channel,
      key,
      line,
      rank,
      seq: nextSeq++,
      createdAt: t,
      notBefore: merge ? t + limits.mergeWindowMs : t,
      merge: merge ? { key: merge.key, render: merge.render, names: [merge.name] } : null,
    };
    if (!makeRoom(entry, t)) return 'dropped';
    waiting.push(entry);
    pump();
    return waiting.includes(entry) ? 'queued' : 'sent';
  }

  // The streamer's chat was stopped: what waits for that channel is not sent.
  function dropChannel(channel) {
    const key = channelKey(channel);
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].key === key) waiting.splice(i, 1);
    }
    schedule(now(), connected());
  }

  function clear() {
    waiting.length = 0;
    stopTimer();
  }

  return { enqueue, dropChannel, clear, pending: () => waiting.length };
}

module.exports = { createChatDispatcher, chatLine, channelKey, MAX_CHAT_LINE, MAX_ACTION_LINE, PRIORITY, DEFAULTS };
