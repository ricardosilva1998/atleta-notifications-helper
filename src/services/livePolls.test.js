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
    getStreamer: () => world.streamer,
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
    assert.equal(w.said.length, 2);
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

  test('a failed read keeps what is known; a missing permission is passed on', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    await w.lp.live(7);
    w.latest = Object.assign(new Error('twitch_failed'), { code: 'twitch_failed' });
    w.t += 5000;
    assert.equal((await w.lp.live(7)).poll.id, 'poll-9');
    w.latest = Object.assign(new Error('needs_reconnect'), { code: 'needs_reconnect' });
    w.t += 5000;
    await assert.rejects(w.lp.live(7), (err) => err.code === 'needs_reconnect');
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
