'use strict';

// The live poll and prediction per streamer (services/livePolls.js) with fakes for the bus, the chat bot, the
// database and Twitch, and a clock the tests move: what the card, the bar and the bot get from EventSub's events, from
// the card's own buttons and from reads of Twitch. All ids, names and texts are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createLivePolls } = require('./livePolls');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const TEXTS = {
  polls_chat_enabled: 1,
  poll_start_template: 'Poll: {title} — vote now! ({time} to vote)',
  poll_end_template: 'Poll closed: {winner} won with {percent}% of the votes.',
  prediction_start_template: 'Prediction: {title} — place your channel points! ({time} to predict)',
  prediction_lock_template: 'Predictions are locked for "{title}". Good luck!',
  prediction_end_template: '{outcome} wins! {winners} viewers share {points} channel points.',
  prediction_cancel_template: 'Prediction cancelled: "{title}". Everyone gets their channel points back.',
};

function setup({ streamer = { id: 7, ...TEXTS }, latest = { poll: null, prediction: null } } = {}) {
  const world = { t: NOW, emitted: [], said: [], reads: 0, latest, streamer };
  world.lp = createLivePolls({
    emit: (channel, payload) => world.emitted.push({ channel, payload }),
    send: (_streamerId, text) => world.said.push(text),
    getStreamer: () => {
      if (world.streamer instanceof Error) throw world.streamer;
      return world.streamer;
    },
    fetchLatest: async () => {
      world.reads += 1;
      if (world.latest instanceof Error) throw world.latest;
      return world.latest;
    },
    now: () => world.t,
  });
  return world;
}

// EventSub's events (version 1), synthetic.
const choices = (yes, no) => [{ id: 'c1', title: 'Yes', votes: yes }, { id: 'c2', title: 'No', votes: no }];
const pollBegin = { id: 'poll-1', title: 'Top 5?', choices: [{ id: 'c1', title: 'Yes' }, { id: 'c2', title: 'No' }], started_at: iso(NOW), ends_at: iso(NOW + 120000) };
const pollProgress = { ...pollBegin, choices: choices(48, 27) };
const pollEnd = { id: 'poll-1', title: 'Top 5?', choices: choices(48, 27), status: 'completed', started_at: iso(NOW), ended_at: iso(NOW + 120000) };
const outcomes = [{ id: 'o1', title: 'Clean', color: 'blue', users: 18, channel_points: 12400 }, { id: 'o2', title: 'Chaos', color: 'pink', users: 9, channel_points: 5100 }];
const predictionBegin = { id: 'pred-1', title: 'Clean first lap?', outcomes: outcomes.map(({ id, title, color }) => ({ id, title, color })), started_at: iso(NOW), locks_at: iso(NOW + 60000) };
const predictionLock = { id: 'pred-1', title: 'Clean first lap?', outcomes, started_at: iso(NOW), locked_at: iso(NOW + 60000) };
const predictionEnd = (status) => ({ id: 'pred-1', title: 'Clean first lap?', outcomes, status, winning_outcome_id: status === 'resolved' ? 'o1' : null, started_at: iso(NOW), ended_at: iso(NOW + 90000) });

// The same poll and prediction as Twitch's Get Polls and Get Predictions answer them, and what twitchPolls throws (a
// PollsError: an Error whose code is one of pollRules.ERRORS'), synthetic.
const helixPoll1 = (status, endedAt = null) => ({ id: 'poll-1', title: 'Top 5?', status, duration: 120, started_at: iso(NOW), ended_at: endedAt === null ? null : iso(endedAt), choices: choices(48, 27) });
const helixPrediction1 = (status) => ({ id: 'pred-1', title: 'Clean first lap?', status, outcomes, created_at: iso(NOW), prediction_window: 60, locked_at: status === 'LOCKED' ? iso(NOW + 60000) : null });
const refusal = (code) => Object.assign(new Error(`${code}: synthetic`), { code });

describe('EventSub\'s events', () => {
  test('a poll started on Twitch: the card and the bar get it at once; the bot announces its start and its result, nothing in between', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.equal(w.lp.snapshot(7).poll.state, 'running');
    assert.deepEqual(w.emitted.map((e) => [e.channel, e.payload.type, e.payload.poll.id]), [['poll:7', 'poll-state', 'poll-1']]);
    assert.deepEqual(w.said, ['Poll: Top 5? — vote now! (2:00 to vote)']);
    w.t += 30000;
    w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    assert.deepEqual(w.lp.snapshot(7).poll.options.map((o) => o.votes), [48, 27]);
    assert.equal(w.emitted.length, 2);
    assert.equal(w.said.length, 1);
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    assert.equal(w.lp.snapshot(7).poll.result, 'won');
    assert.deepEqual(w.said.slice(1), ['Poll closed: Yes won with 64% of the votes.']);
  });

  test('a prediction: its start, its lock and its result; a cancel says the points go back', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.prediction.begin', predictionBegin);
    w.t += 60000;
    w.lp.onEvent(7, 'channel.prediction.lock', predictionLock);
    assert.equal(w.lp.snapshot(7).prediction.state, 'locked');
    w.lp.onEvent(7, 'channel.prediction.end', predictionEnd('resolved'));
    assert.deepEqual(w.said, [
      'Prediction: Clean first lap? — place your channel points! (1:00 to predict)',
      'Predictions are locked for "Clean first lap?". Good luck!',
      'Clean wins! 18 viewers share 17500 channel points.',
    ]);
    const c = setup();
    c.lp.onEvent(7, 'channel.prediction.end', predictionEnd('canceled'));
    assert.deepEqual(c.said, ['Prediction cancelled: "Clean first lap?". Everyone gets their channel points back.']);
  });

  test('the card\'s own button and EventSub report the same moment: one line each', () => {
    const w = setup();
    w.lp.setFromTwitch(7, 'poll', { ...pollBegin, status: 'ACTIVE', duration: 120 }, 'start');
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    w.lp.setFromTwitch(7, 'poll', { ...pollEnd, status: 'TERMINATED' }, 'end');
    w.lp.onEvent(7, 'channel.poll.end', { ...pollEnd, status: 'terminated' });
    assert.deepEqual(w.said, ['Poll: Top 5? — vote now! (2:00 to vote)', 'Poll closed: Yes won with 64% of the votes.']);
    assert.equal(w.emitted.length, 2, 'what EventSub repeats changes nothing on the bar');
  });

  test('a streamer\'s id given as text is the same streamer: the button and EventSub announce a moment once', async () => {
    const w = setup();
    w.lp.setFromTwitch('7', 'poll', { ...pollBegin, status: 'ACTIVE', duration: 120 }, 'start');
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.deepEqual(w.said, ['Poll: Top 5? — vote now! (2:00 to vote)']);
    assert.deepEqual(w.emitted.map((e) => e.channel), ['poll:7']);
    assert.equal(w.lp.snapshot('7').poll.id, 'poll-1');
    assert.equal(w.lp.barState('7').poll.id, 'poll-1');
    assert.equal((await w.lp.live('7')).poll.id, 'poll-1');
    assert.equal(w.reads, 0, 'EventSub spoke just now, about the same streamer');
  });

  test('a late or repeated event never takes a poll back, and an earlier poll never replaces a later one', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.equal(w.lp.snapshot(7).poll.state, 'ended');
    assert.equal(w.said.length, 2, 'the repeated begin is not announced again');
    w.t = NOW + 300000;
    w.lp.onEvent(7, 'channel.poll.begin', { ...pollBegin, id: 'poll-2', started_at: iso(NOW + 300000), ends_at: iso(NOW + 360000) });
    w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    assert.equal(w.lp.snapshot(7).poll.id, 'poll-2');
  });

  test('an event of another type is ignored', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.follow', { user_name: 'Viewer' });
    assert.deepEqual(w.emitted, []);
  });
});

describe('what the bot says', () => {
  test('nothing with the announcements off or a text emptied; a title never starts a command', () => {
    const off = setup({ streamer: { id: 7, ...TEXTS, polls_chat_enabled: 0 } });
    off.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.deepEqual(off.said, []);
    assert.equal(off.emitted.length, 1, 'the bar still gets it');
    const emptied = setup({ streamer: { id: 7, ...TEXTS, poll_start_template: '' } });
    emptied.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.deepEqual(emptied.said, []);
    const bare = setup({ streamer: { id: 7, ...TEXTS, poll_start_template: '{title}' } });
    bare.lp.onEvent(7, 'channel.poll.begin', { ...pollBegin, title: '!ban everyone' });
    assert.deepEqual(bare.said, ['ban everyone']);
  });

  test('a tie names every tied choice; a poll nobody voted in has no result line', () => {
    const tie = setup();
    tie.lp.onEvent(7, 'channel.poll.end', { ...pollEnd, choices: choices(5, 5) });
    assert.deepEqual(tie.said, ['Poll closed: Yes / No won with 50% of the votes.']);
    const none = setup();
    none.lp.onEvent(7, 'channel.poll.end', { ...pollEnd, choices: choices(0, 0) });
    assert.deepEqual(none.said, []);
  });
});

describe('what the card and the bar are given', () => {
  test('the card keeps a result 30 seconds; the bar is given it as stored, with the server\'s clock', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    w.t = NOW + 120000 + 29000;
    assert.equal(w.lp.snapshot(7).poll.id, 'poll-1');
    w.t = NOW + 120000 + 30000;
    assert.equal(w.lp.snapshot(7).poll, null);
    assert.equal(w.lp.barState(7).poll.id, 'poll-1');
    assert.equal(w.lp.barState(7).serverNow, w.t);
    assert.deepEqual(w.lp.snapshot(8), { poll: null, prediction: null, serverNow: w.t });
  });
});

describe('reading Twitch (live)', () => {
  const helixPoll = { id: 'poll-9', title: 'Started on Twitch', status: 'ACTIVE', duration: 120, started_at: iso(NOW - 10000), choices: choices(3, 1) };

  test('with no event, a read finds a poll started on Twitch: shown and given to the bar, never announced', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    const seen = await w.lp.live(7);
    assert.equal(seen.poll.id, 'poll-9');
    assert.equal(w.reads, 1);
    assert.equal(w.emitted.length, 1);
    assert.deepEqual(w.said, [], 'a read after a restart must not announce a poll that is already running');
  });

  test('after 30 seconds without events, a read updates what EventSub told: the result shows, never announced', async () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    w.t += 30000;
    w.latest = { poll: helixPoll1('COMPLETED', NOW + 30000), prediction: null };
    const seen = await w.lp.live(7);
    assert.equal(w.reads, 1);
    assert.equal(seen.poll.state, 'ended');
    assert.equal(w.lp.snapshot(7).poll.result, 'won');
    assert.deepEqual(w.said, ['Poll: Top 5? — vote now! (2:00 to vote)'], 'only the start EventSub reported is announced');
  });

  test('at most one read every 5 seconds, shared by callers at the same time; none while EventSub spoke in the last 30 seconds', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    await Promise.all([w.lp.live(7), w.lp.live(7)]);
    assert.equal(w.reads, 1);
    w.t += 4999;
    await w.lp.live(7);
    assert.equal(w.reads, 1);
    w.t += 1;
    await w.lp.live(7);
    assert.equal(w.reads, 2);
    w.lp.onEvent(7, 'channel.poll.progress', { ...pollProgress, id: 'poll-9', started_at: helixPoll.started_at });
    w.t += 29999;
    await w.lp.live(7);
    assert.equal(w.reads, 2);
    w.t += 1;
    await w.lp.live(7);
    assert.equal(w.reads, 3);
  });

  test('a running poll past its end is read although EventSub spoke in the last 30 seconds: its result shows, never announced', async () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    for (const at of [30000, 60000, 90000, 119000]) {
      w.t = NOW + at;
      w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    }
    w.latest = { poll: helixPoll1('COMPLETED', NOW + 120000), prediction: null };
    await w.lp.live(7);
    assert.equal(w.reads, 0, 'before its end, EventSub speaking is enough');
    w.t = NOW + 120000; // its end event never comes
    const seen = await w.lp.live(7);
    assert.equal(w.reads, 1, 'at its end, although EventSub spoke a second ago');
    assert.equal(seen.poll.state, 'ended');
    assert.equal(w.lp.snapshot(7).poll.state, 'ended');
    assert.deepEqual(w.said, ['Poll: Top 5? — vote now! (2:00 to vote)']);
  });

  test('a running prediction past its lock time is read too, still at most once every 5 seconds', async () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.prediction.begin', predictionBegin);
    w.t = NOW + 59000;
    w.lp.onEvent(7, 'channel.prediction.progress', { ...predictionBegin, outcomes });
    w.latest = { poll: null, prediction: helixPrediction1('ACTIVE') }; // Twitch has not locked it yet
    w.t = NOW + 60000;
    await w.lp.live(7);
    assert.equal(w.reads, 1, 'at its lock time, although EventSub spoke a second ago');
    w.latest = { poll: null, prediction: helixPrediction1('LOCKED') };
    w.t += 4999;
    await w.lp.live(7);
    assert.equal(w.reads, 1);
    w.t += 1;
    assert.equal((await w.lp.live(7)).prediction.state, 'locked');
    assert.equal(w.reads, 2);
    assert.equal(w.said.length, 1, 'only the start EventSub reported is announced');
  });

  test('a read Twitch does not answer keeps what is known and is logged once until a read works', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    await w.lp.live(7);
    w.latest = refusal('twitch_failed');
    for (let i = 0; i < 3; i += 1) {
      w.t += 5000;
      assert.equal((await w.lp.live(7)).poll.id, 'poll-9');
    }
    assert.equal(w.reads, 4);
    assert.equal(warn.mock.callCount(), 1, 'one line for the whole streak');
    const line = warn.mock.calls[0].arguments.join(' ');
    assert.match(line, /^\[Polls\] /);
    assert.match(line, /streamer 7\b/);
    assert.match(line, /twitch_failed/);
    w.latest = { poll: helixPoll, prediction: null };
    w.t += 5000;
    await w.lp.live(7);
    w.latest = refusal('twitch_failed');
    w.t += 5000;
    await w.lp.live(7);
    assert.equal(warn.mock.callCount(), 2, 'a read that works ends the streak');
  });

  test('a missing permission is passed on to every caller until the next read, 5 seconds later; a read that works forgets it', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    await w.lp.live(7);
    w.latest = refusal('needs_reconnect');
    w.t += 5000;
    const both = await Promise.allSettled([w.lp.live(7), w.lp.live(7)]);
    assert.deepEqual(both.map((r) => r.status === 'rejected' && r.reason.code), ['needs_reconnect', 'needs_reconnect']);
    w.t += 4999;
    await assert.rejects(w.lp.live(7), (err) => err.code === 'needs_reconnect');
    assert.equal(w.reads, 2, 'every caller is answered from the one read');
    w.latest = { poll: helixPoll, prediction: null };
    w.t += 1;
    assert.equal((await w.lp.live(7)).poll.id, 'poll-9');
    w.t += 1;
    assert.equal((await w.lp.live(7)).poll.id, 'poll-9', 'a read that works forgets it');
    assert.equal(w.reads, 3);
  });

  test('a read that breaks in this module\'s own code keeps what is known and is logged with its stack', async (t) => {
    const error = t.mock.method(console, 'error', () => {});
    const bug = new TypeError('synthetic: the bus broke');
    const lp = createLivePolls({
      emit: () => { throw bug; },
      send: () => {},
      getStreamer: () => ({ id: 7, ...TEXTS }),
      fetchLatest: async () => ({ poll: helixPoll, prediction: null }),
      now: () => NOW,
    });
    assert.equal((await lp.live(7)).poll.id, 'poll-9', 'stored before the bus broke, and the card is answered');
    assert.equal(error.mock.callCount(), 1);
    const [line, logged] = error.mock.calls[0].arguments;
    assert.match(line, /^\[Polls\] .*streamer 7\b/);
    assert.equal(logged, bug, 'the error itself, so its stack is printed');
  });

  test('a read that breaks before Twitch is asked never stops the next reads, and is logged', async (t) => {
    const error = t.mock.method(console, 'error', () => {});
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    w.streamer = new TypeError('synthetic: the row could not be read');
    assert.equal((await w.lp.live(7)).poll, null);
    assert.equal(w.reads, 0);
    assert.equal(error.mock.callCount(), 1);
    assert.match(error.mock.calls[0].arguments[0], /^\[Polls\] .*streamer 7\b/);
    w.streamer = { id: 7, ...TEXTS };
    w.t += 5000;
    assert.equal((await w.lp.live(7)).poll.id, 'poll-9', 'read again 5 seconds later');
    assert.equal(w.reads, 1);
  });
});

describe('reading Twitch again at once (recheck), after a refusal says the card may be stale', () => {
  test('a poll Twitch ended early whose end was lost, while the prediction\'s events keep EventSub fresh: the next live() reads, within 5 seconds of the last read too', async () => {
    const w = setup({ latest: { poll: helixPoll1('ACTIVE'), prediction: null } });
    await w.lp.live(7);
    assert.equal(w.reads, 1);
    w.t = NOW + 1000;
    w.lp.onEvent(7, 'channel.prediction.begin', predictionBegin);
    w.latest = { poll: helixPoll1('TERMINATED', NOW + 2000), prediction: helixPrediction1('ACTIVE') }; // its end event never comes
    w.t = NOW + 3000;
    assert.equal((await w.lp.live(7)).poll.state, 'running', 'EventSub spoke a moment ago and Twitch was read 3 seconds ago');
    assert.equal(w.reads, 1);
    w.lp.recheck(7); // Twitch refused End now with `changed`
    const seen = await w.lp.live(7);
    assert.equal(w.reads, 2, 'read at once');
    assert.equal(seen.poll.state, 'ended');
    assert.equal(w.lp.barState(7).poll.state, 'ended');
    assert.deepEqual(w.said, ['Prediction: Clean first lap? — place your channel points! (0:59 to predict)'], 'what a read finds is never announced');
  });

  test('a read already on its way is shared; a streamer with nothing kept is read anyway', async () => {
    const w = setup();
    let release;
    w.latest = new Promise((resolve) => { release = resolve; });
    const first = w.lp.live(7);
    w.lp.recheck(7);
    const second = w.lp.live(7);
    release({ poll: helixPoll1('ACTIVE'), prediction: null });
    await Promise.all([first, second]);
    assert.equal(w.reads, 1);
    const fresh = setup({ latest: { poll: helixPoll1('ACTIVE'), prediction: null } });
    fresh.lp.recheck(8);
    assert.equal((await fresh.lp.live(8)).poll.id, 'poll-1');
    assert.equal(fresh.reads, 1);
  });
});

describe('forgetting a streamer (forget), when their linked Twitch account changes', () => {
  test('the poll and the prediction go, and an open bar is told that nothing runs', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    w.lp.onEvent(7, 'channel.prediction.begin', predictionBegin);
    w.emitted.length = 0;
    w.t = NOW + 5000;
    w.lp.forget(7);
    assert.deepEqual(w.lp.barState(7), { poll: null, prediction: null, serverNow: NOW + 5000 });
    assert.deepEqual(w.lp.snapshot('7'), { poll: null, prediction: null, serverNow: NOW + 5000 });
    assert.deepEqual(w.emitted, [{ channel: 'poll:7', payload: { type: 'poll-state', poll: null, prediction: null, serverNow: NOW + 5000 } }]);
  });

  test('the next live() reads the new channel; a read of the previous one on its way keeps nothing', async () => {
    const w = setup();
    let release;
    w.latest = new Promise((resolve) => { release = resolve; });
    const reading = w.lp.live(7);
    w.lp.forget('7');
    release({ poll: helixPoll1('ACTIVE'), prediction: helixPrediction1('LOCKED') }); // the previous channel's
    await reading;
    assert.deepEqual([w.lp.barState(7).poll, w.lp.barState(7).prediction], [null, null]);
    w.latest = { poll: null, prediction: null };
    await w.lp.live(7);
    assert.equal(w.reads, 2, 'the new channel is read');
    assert.equal(w.lp.barState(7).poll, null);
  });
});

describe('memory', () => {
  test('a streamer with nothing running is forgotten an hour after the last change; one with a poll running is kept', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    w.lp.onEvent(8, 'channel.poll.begin', pollBegin);
    w.t += 60 * 60 * 1000 + 1;
    w.lp.sweep();
    assert.equal(w.lp.barState(7).poll, null);
    assert.equal(w.lp.barState(8).poll.id, 'poll-1');
  });
});
