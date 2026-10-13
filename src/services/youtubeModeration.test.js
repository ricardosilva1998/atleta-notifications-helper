'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ── Stubs: db, config and the YouTube API client ─────────────────────

let streamer;
let bannedWordReads = 0;
const deleted = [];

const dbStub = {
  getStreamerById: () => ({ ...streamer }),
  getBannedWords: () => {
    bannedWordReads++;
    return [{ id: 1, streamer_id: 1, word: 'scamlink', is_regex: 0, created_at: '2026-01-01 12:00:00' }];
  },
  addModLogEntry: () => {},
};
const youtubeStub = {
  deleteYoutubeChatMessage: async (messageId) => { deleted.push(messageId); },
  banYoutubeChatUser: async () => {},
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename;
  if (from && (from.endsWith(`${path.sep}youtubeModeration.js`) || from.endsWith(`${path.sep}chatModeration.js`))) {
    if (request === '../db') return dbStub;
    if (request === '../config') return { bot: { twitchToken: '' }, twitch: { clientId: '' } };
    if (request === './youtube') return youtubeStub;
  }
  return origLoad.call(this, request, parent, isMain);
};
const { moderateYoutubeMessage } = require('./youtubeModeration');
Module._load = origLoad;

const realLog = console.log;
beforeEach(() => {
  console.log = () => {};
  bannedWordReads = 0;
  deleted.length = 0;
  streamer = {
    id: 1, yt_mod_enabled: 1, mod_banned_words_enabled: 1,
    mod_link_protection_enabled: 1, mod_caps_enabled: 0, mod_repetition_enabled: 0,
    mod_symbol_spam_enabled: 0, mod_action_response: 'delete', mod_escalation_enabled: 0,
    mod_log_discord_enabled: 0, mod_exempt_subs: 1,
  };
});
afterEach(() => { console.log = realLog; });

function chatItem(id, text, author = {}) {
  return {
    id,
    snippet: { textMessageDetails: { messageText: text } },
    authorDetails: { displayName: 'Viewer', channelId: 'UC-synthetic', ...author },
  };
}

test('banned words are tested once per YouTube message and apply to members too', async () => {
  assert.deepEqual(await moderateYoutubeMessage(1, chatItem('m1', 'hello everyone'), 'chat-1', 'token'), { moderated: false });
  assert.equal(bannedWordReads, 1);

  const member = { isChatSponsor: true }; // exempt from the other filters
  assert.deepEqual(await moderateYoutubeMessage(1, chatItem('m2', 'scamlink here', member), 'chat-1', 'token'), { moderated: true });
  assert.equal(bannedWordReads, 2);
  assert.deepEqual(deleted, ['m2']);
});
