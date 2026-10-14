'use strict';

// Disabling, enabling and removing an account, against fake services that
// record what was called and in which order. A fake clock stands in for time.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { disableAccount, enableAccount, removeAccount, twitchAccountChanged } = require('./accountLifecycle');

// youtubeChat: the live chat id the YouTube chat manager is polling for the
// streamer, or undefined when it is not polling one.
function fakeServices(streamer, { failing = [], youtubeChat } = {}) {
  const calls = [];
  const clock = { t: 1_000_000 };
  const rec = (name) => (...args) => {
    calls.push([name, ...args]);
    if (failing.includes(name)) throw new Error(`${name} exploded`);
  };
  return {
    calls,
    clock,
    services: {
      now: () => clock.t,
      youtubeChatManager: {
        getLiveChatId: () => youtubeChat || null,
        stopPolling: rec('yt.stop'),
        startPolling: rec('yt.start'),
      },
      db: {
        disableStreamer: rec('db.disable'), enableStreamer: rec('db.enable'), deleteStreamer: rec('db.delete'),
        getStreamerById: () => streamer,
      },
      bus: { emit: rec('bus.emit') },
      eventSubManager: { startForStreamer: rec('eventsub.start'), stopForStreamer: rec('eventsub.stop') },
      streamElementsManager: { startForStreamer: rec('se.start'), stopForStreamer: rec('se.stop') },
      chatManager: { startForStreamer: rec('chat.start'), stopForStreamer: rec('chat.stop'), partChannel: rec('chat.part') },
      timedNotificationManager: {
        stopForStreamer: rec('sponsors.stop'),
        restartForStreamer: rec('sponsors.restart'),
        restartChatForStreamer: rec('sponsors.restartChat'),
      },
    },
  };
}

const names = (calls) => calls.map((c) => c[0]);

const FULLY_ON = {
  id: 5, overlay_enabled: 1, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt',
  chatbot_enabled: 1, twitch_username: 'some_streamer',
};

describe('disableAccount', () => {
  test('marks the account (which also closes its sessions) and then stops every live connection', () => {
    const { calls, services } = fakeServices(FULLY_ON);
    disableAccount(5, 'Disabled by admin', services);
    assert.deepEqual(calls[0], ['db.disable', 5, 'Disabled by admin']);
    assert.deepEqual(names(calls).slice(1).sort(), ['bus.emit', 'chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop', 'yt.stop']);
    assert.deepEqual(calls.find((c) => c[0] === 'eventsub.stop'), ['eventsub.stop', 5]);
    assert.deepEqual(calls.find((c) => c[0] === 'yt.stop'), ['yt.stop', 5]);
    assert.deepEqual(calls.find((c) => c[0] === 'bus.emit'), ['bus.emit', 'overlay-disabled:5']);
  });

  test('stops the others when one manager throws, and says so', () => {
    const { calls, services } = fakeServices(FULLY_ON, { failing: ['eventsub.stop', 'chat.stop', 'yt.stop'] });
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      disableAccount(5, null, services);
    } finally {
      console.error = original;
    }
    assert.deepEqual(names(calls).slice(1).sort(), ['bus.emit', 'chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop', 'yt.stop']);
    assert.equal(logged.length, 3);
    assert.match(logged[0], /EventSub stop failed for streamer 5: eventsub\.stop exploded/);
    assert.ok(logged.some((line) => /YouTube chat stop failed for streamer 5: yt\.stop exploded/.test(line)));
  });
});

describe('enableAccount', () => {
  test('clears the flag and restarts what the streamer had switched on', () => {
    const { calls, services } = fakeServices(FULLY_ON);
    enableAccount(5, services);
    assert.deepEqual(calls[0], ['db.enable', 5]);
    assert.deepEqual(names(calls).slice(1).sort(),
      ['chat.start', 'eventsub.start', 'se.start', 'sponsors.restart', 'sponsors.restartChat']);
    assert.equal(names(calls).some((n) => n.endsWith('.stop')), false);
  });

  test('starts nothing the streamer had off (no overlay, no StreamElements token, no chatbot)', () => {
    const quiet = { id: 5, overlay_enabled: 0, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt', chatbot_enabled: 0, twitch_username: 'x' };
    const { calls, services } = fakeServices(quiet);
    enableAccount(5, services);
    assert.deepEqual(names(calls), ['db.enable']);
  });

  test('without a StreamElements token it connects EventSub only', () => {
    const { calls, services } = fakeServices({ ...FULLY_ON, streamelements_jwt: null, chatbot_enabled: 0 });
    enableAccount(5, services);
    assert.deepEqual(names(calls).slice(1).sort(), ['eventsub.start', 'sponsors.restart', 'sponsors.restartChat']);
  });

  // The event connections serve the overlay and the chatbot's thank-yous and sponsor messages, so either one
  // being on brings them back, as it does when the app boots (db.getOverlayOrChatbotStreamers).
  test('the chatbot alone needs no overlay, matching how the app boots: it brings back the event connections too', () => {
    const { calls, services } = fakeServices({
      id: 5, overlay_enabled: 0, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt', chatbot_enabled: 1, twitch_username: 'some_streamer',
    });
    enableAccount(5, services);
    assert.deepEqual(calls[0], ['db.enable', 5]);
    assert.deepEqual(names(calls).slice(1).sort(), ['chat.start', 'eventsub.start', 'se.start', 'sponsors.restart', 'sponsors.restartChat']);
  });

  test('the overlay alone brings them back too, without the chat bot', () => {
    const { calls, services } = fakeServices({ id: 5, overlay_enabled: 1, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt', chatbot_enabled: 0 });
    enableAccount(5, services);
    assert.deepEqual(names(calls).slice(1).sort(), ['eventsub.start', 'se.start', 'sponsors.restart', 'sponsors.restartChat']);
  });

  test('EventSub needs a broadcaster token to connect; StreamElements and the sponsor rotation do not', () => {
    const { calls, services } = fakeServices({ id: 5, overlay_enabled: 1, broadcaster_access_token: '', streamelements_jwt: 'jwt', chatbot_enabled: 0 });
    enableAccount(5, services);
    assert.deepEqual(names(calls).slice(1).sort(), ['se.start', 'sponsors.restart', 'sponsors.restartChat']);
    const chatbotOnly = fakeServices({ id: 5, overlay_enabled: 0, chatbot_enabled: 1, twitch_username: 'some_streamer' });
    enableAccount(5, chatbotOnly.services);
    assert.deepEqual(names(chatbotOnly.calls).slice(1).sort(), ['chat.start', 'sponsors.restart', 'sponsors.restartChat']);
  });

  test('a missing streamer starts nothing', () => {
    const { calls, services } = fakeServices(undefined);
    enableAccount(5, services);
    assert.deepEqual(names(calls), ['db.enable']);
  });
});

describe('removeAccount', () => {
  test('stops the live connections before the rows are deleted', () => {
    const { calls, services } = fakeServices(FULLY_ON);
    removeAccount(5, services);
    assert.equal(names(calls).at(-1), 'db.delete');
    assert.deepEqual(calls.at(-1), ['db.delete', 5]);
    assert.deepEqual(names(calls).slice(0, -1).sort(), ['bus.emit', 'chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop', 'yt.stop']);
  });
});

// The YouTube live chat: a disabled account's chat bot stops polling (and so stops
// answering and moderating its chat), and enabling the account soon after picks the
// same chat up again. After a long pause it does not: that stream may be over, and
// polling the chat of a finished stream only fails, over and over.
describe('the YouTube live chat', () => {
  const WITH_CHAT = { ...FULLY_ON, yt_chatbot_enabled: 1 };
  const MINUTE = 60_000;
  const startsOf = (calls) => calls.filter((c) => c[0] === 'yt.start');

  test('disabling stops the chat the bot was polling for the account, even when the account has no other connection', () => {
    const { calls, services } = fakeServices({ id: 9, yt_chatbot_enabled: 1 }, { youtubeChat: 'chat-1' });
    disableAccount(9, null, services);
    assert.deepEqual(calls.filter((c) => c[0] === 'yt.stop'), [['yt.stop', 9]]);
  });

  test('enabling it again soon after starts polling the same chat again, once', () => {
    const { calls, services, clock } = fakeServices(WITH_CHAT, { youtubeChat: 'chat-1' });
    disableAccount(5, null, services);
    clock.t += 29 * MINUTE;
    enableAccount(5, services);
    assert.deepEqual(startsOf(calls), [['yt.start', 5, 'chat-1']]);

    // The memory of that chat is used up: enabling again (after another disable that found no chat) starts nothing.
    const again = fakeServices(WITH_CHAT);
    disableAccount(5, null, again.services);
    enableAccount(5, again.services);
    assert.deepEqual(startsOf(again.calls), []);
  });

  test('after a long pause the chat is not started again', () => {
    const { calls, services, clock } = fakeServices(WITH_CHAT, { youtubeChat: 'chat-1' });
    disableAccount(5, null, services);
    clock.t += 31 * MINUTE;
    enableAccount(5, services);
    assert.deepEqual(startsOf(calls), []);
  });

  test('an account whose chat bot was not polling anything starts nothing when enabled', () => {
    const { calls, services } = fakeServices(WITH_CHAT);
    disableAccount(5, null, services);
    enableAccount(5, services);
    assert.deepEqual(startsOf(calls), []);
  });

  test('a chat bot the streamer switched off meanwhile is not started', () => {
    const { calls, services } = fakeServices({ ...FULLY_ON, yt_chatbot_enabled: 0 }, { youtubeChat: 'chat-1' });
    disableAccount(5, null, services);
    enableAccount(5, services);
    assert.deepEqual(startsOf(calls), []);
  });

  test('a chat is remembered per account', () => {
    const first = fakeServices({ ...WITH_CHAT, id: 5 }, { youtubeChat: 'chat-5' });
    const second = fakeServices({ ...WITH_CHAT, id: 6 }, { youtubeChat: 'chat-6' });
    disableAccount(5, null, first.services);
    disableAccount(6, null, second.services);
    enableAccount(6, second.services);
    assert.deepEqual(startsOf(second.calls), [['yt.start', 6, 'chat-6']]);
    enableAccount(5, first.services);
    assert.deepEqual(startsOf(first.calls), [['yt.start', 5, 'chat-5']]);
  });

  test('removing an account forgets its chat', () => {
    const { calls, services } = fakeServices(WITH_CHAT, { youtubeChat: 'chat-1' });
    removeAccount(5, services);
    assert.deepEqual(calls.filter((c) => c[0] === 'yt.stop'), [['yt.stop', 5]]);
    enableAccount(5, services); // the same id, were it ever to exist again
    assert.deepEqual(startsOf(calls), []);
  });

  test('a manager that fails to start the chat does not stop the others from starting', () => {
    const { calls, services } = fakeServices(WITH_CHAT, { youtubeChat: 'chat-1', failing: ['yt.start'] });
    disableAccount(5, null, services);
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    try {
      enableAccount(5, services);
    } finally {
      console.error = original;
    }
    assert.ok(names(calls).includes('eventsub.start') && names(calls).includes('chat.start'));
    assert.ok(logged.some((line) => /YouTube chat start failed for streamer 5/.test(line)));
  });
});

// A streamer's linked Twitch account changed (db.linkTwitch has already cleared the
// authorization that belonged to the previous one): what ran for the previous
// account stops, and the chat bot moves to the new channel.
describe('twitchAccountChanged', () => {
  const NOW_LINKED = { id: 5, twitch_username: 'new_channel', chatbot_enabled: 1, enabled: 1 };
  const eventSubStops = (calls) => calls.filter((c) => c[0] === 'eventsub.stop');

  test('stops EventSub, leaves the previous channel and joins the new one, in that order', () => {
    const { calls, services } = fakeServices(NOW_LINKED);
    twitchAccountChanged(5, 'old_channel', services);
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.part', 'old_channel'], ['chat.start', 5]]);
  });

  test('does not start EventSub again: without a broadcaster authorization there is nothing to connect with', () => {
    const { calls, services } = fakeServices(NOW_LINKED);
    twitchAccountChanged(5, 'old_channel', services);
    assert.deepEqual(calls.filter((c) => c[0].endsWith('.start') && c[0] !== 'chat.start'), []);
  });

  test('without a chat bot the new channel is not joined, but the old one is still left', () => {
    const { calls, services } = fakeServices({ ...NOW_LINKED, chatbot_enabled: 0 });
    twitchAccountChanged(5, 'old_channel', services);
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.part', 'old_channel']]);
  });

  test('a streamer who lost the account to someone else (no channel linked any more) only stops and leaves', () => {
    const { calls, services } = fakeServices({ id: 5, twitch_username: null, chatbot_enabled: 1, enabled: 1 });
    twitchAccountChanged(5, 'shared_channel', services);
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.part', 'shared_channel']]);
  });

  test('a first link has no previous channel to leave', () => {
    const { calls, services } = fakeServices(NOW_LINKED);
    twitchAccountChanged(5, null, services);
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.start', 5]]);
  });

  test('a disabled account does not join', () => {
    const { calls, services } = fakeServices({ ...NOW_LINKED, enabled: 0 });
    twitchAccountChanged(5, 'old_channel', services);
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.part', 'old_channel']]);
  });

  test('one manager failing does not stop the others, and says so', () => {
    const { calls, services } = fakeServices(NOW_LINKED, { failing: ['eventsub.stop', 'chat.part'] });
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      twitchAccountChanged(5, 'old_channel', services);
    } finally {
      console.error = original;
    }
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.part', 'old_channel'], ['chat.start', 5]]);
    assert.equal(logged.length, 2);
    assert.match(logged[0], /EventSub stop failed for streamer 5/);
    assert.match(logged[1], /Twitch chat leave failed for streamer 5/);
  });

  test('a streamer who is not found only has its connections stopped', () => {
    const { calls, services } = fakeServices(undefined);
    twitchAccountChanged(5, 'old_channel', services);
    assert.deepEqual(calls, [['eventsub.stop', 5], ['chat.part', 'old_channel']]);
  });
});
