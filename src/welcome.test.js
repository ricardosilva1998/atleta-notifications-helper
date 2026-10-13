'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const EventEmitter = require('events');
const Module = require('module');

const WELCOME_FILE = path.join(__dirname, 'welcome.js');
const GUILD = '100000000000000001';

const client = new EventEmitter();
const sends = [];
let sendResult = true;
let configs = [];
const discordStub = {
  client,
  buildEmbed: (fields) => fields,
  async sendToGuildChannel(guildId, streamerId, channelId, payload) {
    sends.push({ guildId, streamerId, channelId, payload });
    if (sendResult instanceof Error) throw sendResult;
    return sendResult;
  },
};
const dbStub = { getGuildConfigsByGuildId: (id) => (id === GUILD ? configs : []) };

const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === WELCOME_FILE) {
    if (request === './discord') return discordStub;
    if (request === './db') return dbStub;
  }
  return origLoad(request, parent, isMain);
};
const welcome = require('./welcome');
Module._load = origLoad;

const logs = [];
const { log, error } = console;
console.log = (...args) => logs.push(args.join(' '));
welcome.start();
console.log = log;

const member = { id: '600000000000000001', user: { username: 'newbie' }, guild: { id: GUILD, name: 'Pit Lane' } };

async function join() {
  logs.length = 0;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  try {
    for (const listener of client.listeners('guildMemberAdd')) await listener(member);
  } finally {
    console.log = log;
    console.error = error;
  }
}

beforeEach(() => {
  sends.length = 0;
  sendResult = true;
  configs = [{ guild_id: GUILD, streamer_id: 13, twitch_username: 'andre_vilela_', welcome_enabled: 1, welcome_channel_id: '200000000000000001', welcome_message: 'Hi there' }];
});

test('posts into the configured channel of the server the member joined, pinging only them', async () => {
  await join();
  assert.equal(sends.length, 1);
  const { guildId, streamerId, channelId, payload } = sends[0];
  assert.deepEqual([guildId, streamerId, channelId], [GUILD, 13, '200000000000000001']);
  assert.equal(payload.content, `Hey <@${member.id}>!`);
  assert.deepEqual(payload.allowedMentions, { users: [member.id] });
  assert.equal(payload.embeds[0].description, 'Hi there');
  assert.match(logs.join('\n'), /Welcomed newbie in Pit Lane/);
});

test('a stored message over the embed limit is shortened instead of failing every welcome', async () => {
  configs[0].welcome_message = 'w'.repeat(5000);
  await join();
  assert.equal(sends[0].payload.embeds[0].description.length, 4000);
});

test('an empty message falls back to the default one', async () => {
  configs[0].welcome_message = null;
  await join();
  assert.match(sends[0].payload.embeds[0].description, /welcome/i);
});

test('skips servers with welcome off or no channel', async () => {
  configs = [
    { ...configs[0], welcome_enabled: 0 },
    { ...configs[0], streamer_id: 14, welcome_channel_id: null },
  ];
  await join();
  assert.equal(sends.length, 0);
});

test('a channel that is not available, or a Discord error, is logged and the next config still runs', async () => {
  configs = [configs[0], { ...configs[0], streamer_id: 14, welcome_channel_id: '200000000000000002' }];
  sendResult = false;
  await join();
  assert.equal(sends.length, 2);
  assert.match(logs.join('\n'), /not available in Pit Lane/);

  sendResult = new Error('Missing Permissions');
  await join();
  assert.equal(sends.length, 4);
  assert.match(logs.join('\n'), /Missing Permissions/);
});
