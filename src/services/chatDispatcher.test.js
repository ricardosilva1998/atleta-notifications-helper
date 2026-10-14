'use strict';

// The queue every line of the shared Twitch bot goes through. A fake clock and
// fake timers drive it, so nothing here waits; one test runs a child process to
// show its timer does not keep the app alive. Channels and names are synthetic.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { createChatDispatcher, chatLine, MAX_CHAT_LINE } = require('./chatDispatcher');

// A clock that only moves when a test says so, and timers that fire on it.
function fakeTime() {
  let t = 0;
  let nextId = 1;
  let timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const timer = { id: nextId++, at: t + ms, fn };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timers = timers.filter((x) => x !== timer); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
      }
      t = end;
    },
    timerCount: () => timers.length,
  };
}

let time;
let sent;
let logs;

function dispatcher(options = {}) {
  return createChatDispatcher({
    send: (channel, line) => { sent.push({ at: time.now(), channel, line }); return Promise.resolve(); },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    log: { warn: (line) => logs.push(['warn', line]), error: (line) => logs.push(['error', line]) },
    ...options,
  });
}

const lines = () => sent.map((s) => s.line);

beforeEach(() => {
  time = fakeTime();
  sent = [];
  logs = [];
});

describe('sending', () => {
  test('a message goes out at once when nothing holds it', () => {
    const chat = dispatcher();
    assert.equal(chat.enqueue({ channel: '#somechannel', text: 'hello', priority: 'high' }), 'sent');
    assert.deepEqual(sent, [{ at: 0, channel: '#somechannel', line: 'hello' }]);
    assert.equal(time.timerCount(), 0, 'nothing left to wait for');
  });

  test('one timer at most, however many messages wait', () => {
    const chat = dispatcher();
    for (let i = 0; i < 10; i++) chat.enqueue({ channel: 'chan', text: `line ${i}` });
    assert.equal(time.timerCount(), 1);
    time.advance(3_000);
    assert.equal(sent.length, 3);
    assert.equal(time.timerCount(), 1);
  });

  test('a failed send is logged and the next message still goes', async () => {
    const chat = createChatDispatcher({
      send: (channel, line) => {
        if (line === 'reject') return Promise.reject('Not connected to server.');
        if (line === 'throw') throw new Error('socket closed');
        sent.push({ channel, line });
        return Promise.resolve();
      },
      now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
      log: { warn: (line) => logs.push(['warn', line]), error: (line) => logs.push(['error', line]) },
    });
    chat.enqueue({ channel: 'a', text: 'reject' });
    chat.enqueue({ channel: 'b', text: 'throw' });
    chat.enqueue({ channel: 'c', text: 'fine' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, [{ channel: 'c', line: 'fine' }]);
    assert.deepEqual(logs, [
      ['error', '[Chat] Failed to send to b: socket closed'],
      ['error', '[Chat] Failed to send to a: Not connected to server.'],
    ]);
  });
});

describe('the bot-wide limit (H11)', () => {
  test('at most 20 messages in any 30 seconds, across all channels', () => {
    const chat = dispatcher();
    for (let i = 0; i < 25; i++) chat.enqueue({ channel: `channel${i}`, text: `line ${i}` });
    assert.equal(sent.length, 20, 'the first 20 go at once');
    time.advance(29_999);
    assert.equal(sent.length, 20, 'none more inside the 30 s');
    time.advance(1);
    assert.equal(sent.length, 25, 'the rest go when the first ones are 30 s old');
  });

  test('no 30-second window ever holds more than 20, however the messages arrive', () => {
    const chat = dispatcher();
    for (let step = 0; step < 200; step++) {
      chat.enqueue({ channel: `channel${step % 40}`, text: `line ${step}` });
      time.advance(step % 7 === 0 ? 2_300 : 100);
    }
    time.advance(300_000);
    assert.equal(sent.length, 200, 'everything was sent in the end');
    for (let i = 0; i + 20 < sent.length; i++) {
      assert.ok(sent[i + 20].at - sent[i].at >= 30_000, `messages ${i} and ${i + 20} are ${sent[i + 20].at - sent[i].at} ms apart`);
    }
  });

  test('the limit can be set', () => {
    const chat = dispatcher({ maxMessages: 5 });
    for (let i = 0; i < 8; i++) chat.enqueue({ channel: `channel${i}`, text: `line ${i}` });
    assert.equal(sent.length, 5);
    time.advance(30_000);
    assert.equal(sent.length, 8);
  });
});

describe('one channel (H11)', () => {
  test('two messages in the same channel are at least 1.5 seconds apart', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: '#SomeChannel', text: 'first' });
    assert.equal(chat.enqueue({ channel: 'somechannel', text: 'second' }), 'queued', '"#SomeChannel" and "somechannel" are one channel');
    chat.enqueue({ channel: 'other', text: 'elsewhere' });
    assert.deepEqual(lines(), ['first', 'elsewhere']);
    time.advance(1_499);
    assert.equal(sent.length, 2);
    time.advance(1);
    assert.deepEqual(sent[2], { at: 1_500, channel: 'somechannel', line: 'second' });
  });

  test('waiting messages go out most important first: moderation and commands, then thank-yous, then sponsors', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: 'chan', text: 'already going' });
    chat.enqueue({ channel: 'chan', text: 'sponsor 1', priority: 'low' });
    chat.enqueue({ channel: 'chan', text: 'thanks 1', priority: 'normal' });
    chat.enqueue({ channel: 'chan', text: 'warning', priority: 'high' });
    chat.enqueue({ channel: 'chan', text: 'sponsor 2', priority: 'low' });
    chat.enqueue({ channel: 'chan', text: 'thanks 2', priority: 'normal' });
    chat.enqueue({ channel: 'chan', text: 'command reply', priority: 'high' });
    time.advance(60_000);
    assert.deepEqual(lines(), ['already going', 'warning', 'command reply', 'thanks 1', 'thanks 2', 'sponsor 1', 'sponsor 2']);
    assert.deepEqual(sent.map((s) => s.at), [0, 1_500, 3_000, 4_500, 6_000, 7_500, 9_000]);
  });

  test('an unknown priority counts as a thank-you', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: 'chan', text: 'already going' });
    chat.enqueue({ channel: 'chan', text: 'sponsor', priority: 'low' });
    chat.enqueue({ channel: 'chan', text: 'unknown', priority: 'urgent!' });
    time.advance(10_000);
    assert.deepEqual(lines(), ['already going', 'unknown', 'sponsor']);
  });

  test('when the bot-wide limit is reached, the channel that posted least recently goes next; sponsor lines wait for all others', () => {
    const chat = dispatcher({ maxMessages: 1, windowMs: 1_000, channelGapMs: 0 });
    chat.enqueue({ channel: 'busy', text: 'busy 1', priority: 'high' });
    chat.enqueue({ channel: 'busy', text: 'busy 2', priority: 'high' });
    chat.enqueue({ channel: 'busy', text: 'busy 3', priority: 'high' });
    chat.enqueue({ channel: 'quiet', text: 'quiet sponsor', priority: 'low' });
    chat.enqueue({ channel: 'quiet2', text: 'quiet command', priority: 'high' });
    chat.enqueue({ channel: 'quiet3', text: 'quiet thanks', priority: 'normal' });
    time.advance(10_000);
    // quiet2 and quiet3 have not posted, so they go before busy's next line (the
    // more important first); the sponsor line takes a token only when no other
    // line is ready in any chat.
    assert.deepEqual(lines(), ['busy 1', 'quiet command', 'quiet thanks', 'busy 2', 'busy 3', 'quiet sponsor']);
  });

  test('a sponsor line still goes when the only other waiting lines are held back', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: 'busy', text: 'busy 1', priority: 'high' });
    chat.enqueue({ channel: 'busy', text: 'busy 2', priority: 'high' }); // waits for the 1.5 s gap
    assert.equal(chat.enqueue({ channel: 'quiet', text: 'quiet sponsor', priority: 'low' }), 'sent');
  });
});

describe('merged thank-yous (H11)', () => {
  const follow = (chat, name, channel = 'chan') => chat.enqueue({
    channel,
    priority: 'normal',
    merge: { key: 'follow', name, render: (names) => `Welcome to the pit crew, ${names.join(' + ')}!` },
  });

  test('the same kind of thank-you within 5 seconds becomes one line', () => {
    const chat = dispatcher();
    assert.equal(follow(chat, 'A'), 'queued');
    time.advance(1_000);
    assert.equal(follow(chat, 'B'), 'merged');
    time.advance(2_000);
    assert.equal(follow(chat, 'C'), 'merged');
    time.advance(1_999);
    assert.deepEqual(sent, [], 'held for 5 s');
    time.advance(1);
    assert.deepEqual(sent, [{ at: 5_000, channel: 'chan', line: 'Welcome to the pit crew, A + B + C!' }]);

    follow(chat, 'D');
    time.advance(5_000);
    assert.deepEqual(lines().slice(1), ['Welcome to the pit crew, D!'], 'a later one starts a new line');
  });

  test('the same name twice is named once; another kind or another channel is not merged', () => {
    const chat = dispatcher();
    follow(chat, 'A');
    assert.equal(follow(chat, 'a'), 'merged');
    chat.enqueue({ channel: 'chan', priority: 'normal', merge: { key: 'sub', name: 'B', render: (names) => `Sub ${names.join(' + ')}` } });
    follow(chat, 'C', 'other');
    time.advance(10_000);
    assert.deepEqual(lines().sort(), ['Sub B', 'Welcome to the pit crew, A!', 'Welcome to the pit crew, C!']);
  });

  test('a name that would make the line too long starts a new line', () => {
    const chat = dispatcher();
    const longName = (letter) => letter.repeat(200);
    follow(chat, longName('a'));
    follow(chat, longName('b'));
    assert.equal(follow(chat, longName('c')), 'queued');
    time.advance(20_000);
    assert.equal(sent.length, 2);
    assert.ok(sent.every((s) => s.line.length <= MAX_CHAT_LINE));
    assert.ok(sent[1].line.includes(longName('c')));
  });

  test('once a line is full, later names join the next waiting line instead of starting more', () => {
    const chat = dispatcher();
    const longName = (letter) => letter.repeat(200);
    for (const letter of ['a', 'b', 'c']) follow(chat, longName(letter));
    assert.equal(follow(chat, longName('d')), 'merged', 'd joins the line c started');
    assert.equal(chat.pending(), 2);
    time.advance(20_000);
    assert.deepEqual(sent.map((s) => s.line.length), [429, 429]);
  });

  test('a thank-you still waiting because of the limits keeps taking names', () => {
    const chat = dispatcher({ maxMessages: 1 });
    chat.enqueue({ channel: 'x', text: 'uses the only token' });
    follow(chat, 'A');
    time.advance(20_000);
    assert.equal(follow(chat, 'B'), 'merged', '20 s later, still waiting for the token');
    time.advance(10_000);
    assert.deepEqual(lines(), ['uses the only token', 'Welcome to the pit crew, A + B!']);
  });
});

describe('dropping (H11)', () => {
  test('a sponsor or timed message that waited more than 60 seconds is dropped; others wait', () => {
    const chat = dispatcher({ maxMessages: 1, windowMs: 90_000 });
    chat.enqueue({ channel: 'a', text: 'uses the only token' });
    chat.enqueue({ channel: 'b', text: 'sponsor', priority: 'low' });
    chat.enqueue({ channel: 'c', text: 'thanks', priority: 'normal' });
    chat.enqueue({ channel: 'd', text: 'reply', priority: 'high' });
    time.advance(60_000);
    assert.equal(sent.length, 1);
    time.advance(30_000);
    assert.deepEqual(lines(), ['uses the only token', 'reply']);
    time.advance(90_000);
    assert.deepEqual(lines(), ['uses the only token', 'reply', 'thanks']);
    assert.deepEqual(logs, [['warn', '[Chat] Dropped 1 waiting message(s) for b: waited over 60 s']]);
  });

  test('at most 20 messages wait per channel: a more important one takes the place of the oldest least important', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: 'chan', text: 'going' });
    for (let i = 0; i < 18; i++) chat.enqueue({ channel: 'chan', text: `reply ${i}`, priority: 'high' });
    chat.enqueue({ channel: 'chan', text: 'old sponsor', priority: 'low' });
    chat.enqueue({ channel: 'chan', text: 'new sponsor', priority: 'low' });
    assert.equal(chat.pending(), 20);
    assert.equal(chat.enqueue({ channel: 'chan', text: 'one more reply', priority: 'high' }), 'queued');
    assert.equal(chat.enqueue({ channel: 'chan', text: 'one more sponsor', priority: 'low' }), 'dropped', 'not more important than any waiting message');
    assert.equal(chat.pending(), 20);
    time.advance(60_000);
    assert.ok(!lines().includes('old sponsor'));
    assert.ok(lines().includes('one more reply'));
    assert.ok(lines().includes('new sponsor'));
    assert.deepEqual(logs, [['warn', '[Chat] Dropped 1 waiting message(s) for chan: queue full']], 'one line a minute per channel');
  });

  test('drops after the last "dropped" line are still reported once that minute is over', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: 'chan', text: 'going' });
    for (let i = 0; i < 20; i++) chat.enqueue({ channel: 'chan', text: `reply ${i}`, priority: 'high' });
    chat.enqueue({ channel: 'chan', text: 'one too many', priority: 'high' });
    chat.enqueue({ channel: 'chan', text: 'two too many', priority: 'high' });
    assert.deepEqual(logs, [['warn', '[Chat] Dropped 1 waiting message(s) for chan: queue full']]);
    time.advance(60_000); // the 20 replies are sent within 30 s; nothing waits for chan after that
    chat.enqueue({ channel: 'other', text: 'any later line' });
    assert.deepEqual(logs, [
      ['warn', '[Chat] Dropped 1 waiting message(s) for chan: queue full'],
      ['warn', '[Chat] Dropped 1 waiting message(s) for chan: queue full'],
    ]);
  });

  test('a stopped channel loses its waiting messages; clear() empties everything', () => {
    const chat = dispatcher();
    chat.enqueue({ channel: 'chan', text: 'first' });
    chat.enqueue({ channel: 'chan', text: 'second' });
    chat.enqueue({ channel: 'other', text: 'first elsewhere' });
    chat.enqueue({ channel: 'other', text: 'second elsewhere' });
    chat.dropChannel('#Chan');
    time.advance(5_000);
    assert.deepEqual(lines(), ['first', 'first elsewhere', 'second elsewhere']);

    chat.enqueue({ channel: 'other', text: 'third elsewhere' });
    chat.enqueue({ channel: 'other', text: 'fourth elsewhere' });
    chat.clear();
    assert.equal(time.timerCount(), 0);
    time.advance(5_000);
    assert.equal(sent.length, 4);
  });
});

describe('every line is cleaned', () => {
  test('one line, trimmed, short enough for tmi.js to send it as one message', () => {
    assert.equal(chatLine('  hi\r\nPRIVMSG #other :spam\u0000 '), 'hi PRIVMSG #other :spam');
    assert.equal(MAX_CHAT_LINE, 499, 'tmi.js splits 500 UTF-16 units or more into two messages');
    assert.equal(chatLine('x'.repeat(600)).length, 499);
    const emoji = chatLine('x'.repeat(498) + '🏁🏁');
    assert.equal(emoji, 'x'.repeat(498), 'an emoji is never cut in half');
    assert.equal(chatLine(null), '');
  });

  test('a line tmi.js sends as an action (/me, .me, \\me) is at most 494 units, so it is not split either', () => {
    for (const lead of ['/me ', '.me ', '\\me ']) {
      const line = chatLine(lead + 'x'.repeat(600));
      assert.equal(line.length, 494, lead);
      const onTheWire = `\u0001ACTION ${line.slice(4)}\u0001`; // what tmi.js action() sends
      assert.ok(onTheWire.length < 500, `${onTheWire.length} units on the wire`);
    }
    assert.equal(chatLine('/men ' + 'x'.repeat(600)).length, 499, 'not an action');
    assert.equal(chatLine('..me ' + 'x'.repeat(600)).length, 499, 'tmi.js sends a ".." line as text');
  });

  test('a merged /me thank-you keeps to the action limit too', () => {
    const chat = dispatcher();
    const render = (names) => `/me thanks ${names.join(' + ')}!`;
    for (const letter of ['a', 'b', 'c']) chat.enqueue({ channel: 'chan', merge: { key: 'follow', name: letter.repeat(240), render } });
    time.advance(20_000);
    // Two of these names make a 495-unit line: fine as text, one too many as an action.
    assert.equal(sent.length, 3, 'no two names of 240 share an action line');
    assert.ok(sent.every((s) => s.line.length <= 494));
  });

  test('the dispatcher sends the cleaned line, and nothing for an empty one', () => {
    const chat = dispatcher();
    assert.equal(chat.enqueue({ channel: 'chan', text: 'a\nb' }), 'sent');
    assert.equal(chat.enqueue({ channel: 'other', text: ' \r\n ' }), 'dropped');
    assert.equal(chat.enqueue({ channel: '', text: 'no channel' }), 'dropped');
    assert.deepEqual(lines(), ['a b']);
  });
});

test('its timer does not keep the process alive', () => {
  const script = `
    const { createChatDispatcher } = require(${JSON.stringify(path.join(__dirname, 'chatDispatcher.js'))});
    const chat = createChatDispatcher({ send: () => Promise.resolve(), channelGapMs: 60000 });
    chat.enqueue({ channel: 'chan', text: 'one' });
    if (chat.enqueue({ channel: 'chan', text: 'two' }) !== 'queued') process.exit(2);
  `;
  const run = spawnSync(process.execPath, ['-e', script], { timeout: 10_000 });
  assert.equal(run.signal, null, 'the process ended by itself');
  assert.equal(run.status, 0);
});
