'use strict';

// Coaching's Discord helpers (direct messages, membership, invites) against a fake discord.js client.
// Nothing reaches Discord or the network. All ids are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const DISCORD_FILE = path.join(__dirname, 'discord.js');
const USER = '123456789012345678';
const GUILD = '223456789012345678';

const fake = { ready: true, sent: [], sendImpl: null, guilds: new Map() };
let discord;
const realFetch = global.fetch;
const origLoad = Module._load.bind(Module);

before(() => {
  class Client {
    constructor() {
      this.users = { send: (id, payload) => { fake.sent.push([id, payload]); return fake.sendImpl ? fake.sendImpl(id, payload) : Promise.resolve({}); } };
      this.guilds = { cache: fake.guilds };
    }
    isReady() { return fake.ready; }
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'discord.js' && parent && parent.filename === DISCORD_FILE) {
      return { Client, GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildVoiceStates: 4 }, EmbedBuilder: class {} };
    }
    return origLoad(request, parent, isMain);
  };
  delete require.cache[DISCORD_FILE];
  discord = require(DISCORD_FILE);
});

after(() => { Module._load = origLoad; global.fetch = realFetch; delete require.cache[DISCORD_FILE]; });
beforeEach(() => { fake.ready = true; fake.sent = []; fake.sendImpl = null; fake.guilds.clear(); });

const codeError = (code) => Object.assign(new Error(`Discord ${code}`), { code });

describe('sendDirectMessage', () => {
  test('sends with no mentions allowed, and answers unreachable for 50007, not_ready before login, failed on a timeout', async () => {
    assert.deepEqual(await discord.sendDirectMessage(USER, { content: 'hi @everyone' }), { ok: true });
    assert.deepEqual(fake.sent[0], [USER, { content: 'hi @everyone', allowedMentions: { parse: [] } }]);

    fake.sendImpl = () => Promise.reject(codeError(50007));
    assert.deepEqual(await discord.sendDirectMessage(USER, { content: 'x' }), { ok: false, reason: 'unreachable' });
    fake.sendImpl = () => Promise.reject(codeError(10013));
    assert.deepEqual(await discord.sendDirectMessage(USER, { content: 'x' }), { ok: false, reason: 'unreachable' });
    fake.sendImpl = () => Promise.reject(codeError(500));
    assert.deepEqual(await discord.sendDirectMessage(USER, { content: 'x' }), { ok: false, reason: 'failed' });

    assert.deepEqual(await discord.sendDirectMessage('abc', { content: 'x' }), { ok: false, reason: 'unreachable' });

    fake.ready = false;
    fake.sent = [];
    assert.deepEqual(await discord.sendDirectMessage(USER, { content: 'x' }), { ok: false, reason: 'not_ready' });
    assert.equal(fake.sent.length, 0);

    // a send that never answers: the 10 s deadline (timers faked so the test is instant)
    fake.ready = true;
    fake.sendImpl = () => new Promise(() => {});
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 10000 ? 0 : ms, ...a);
    try {
      assert.deepEqual(await discord.sendDirectMessage(USER, { content: 'x' }), { ok: false, reason: 'failed' });
    } finally { global.setTimeout = realSetTimeout; }
  });
});

describe('isGuildMember', () => {
  test('answers true from the cache, false for Unknown Member, null for an unknown guild or a Discord error', async () => {
    assert.equal(await discord.isGuildMember(GUILD, USER), null); // unknown guild

    const cache = new Map([[USER, {}]]);
    let fetchImpl = () => Promise.reject(codeError(10007));
    fake.guilds.set(GUILD, { members: { cache, fetch: (id) => fetchImpl(id) } });
    assert.equal(await discord.isGuildMember(GUILD, USER), true);

    assert.equal(await discord.isGuildMember(GUILD, '323456789012345678'), false); // Unknown Member
    fetchImpl = () => Promise.resolve({});
    assert.equal(await discord.isGuildMember(GUILD, '323456789012345678'), true);
    fetchImpl = () => Promise.reject(codeError(500));
    assert.equal(await discord.isGuildMember(GUILD, '423456789012345678'), null);

    fake.ready = false;
    assert.equal(await discord.isGuildMember(GUILD, USER), null);
  });
});

describe('guildName', () => {
  test('reads the cache', () => {
    fake.guilds.set(GUILD, { name: 'Pit Lane' });
    assert.equal(discord.guildName(GUILD), 'Pit Lane');
    assert.equal(discord.guildName('999'), null);
  });
});

describe('fetchInvite', () => {
  test("answers the invite's server, unknown for a 404, unavailable for a network error", async () => {
    const urls = [];
    global.fetch = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ guild: { id: GUILD, name: 'Pit Lane' } }) }; };
    assert.deepEqual(await discord.fetchInvite('ab/c'), { ok: true, guildId: GUILD, guildName: 'Pit Lane' });
    assert.equal(urls[0], 'https://discord.com/api/v10/invites/ab%2Fc');

    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    assert.deepEqual(await discord.fetchInvite('zzz'), { ok: false, reason: 'unknown' });
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    assert.deepEqual(await discord.fetchInvite('zzz'), { ok: false, reason: 'unavailable' });
    global.fetch = async () => { throw new Error('network'); };
    assert.deepEqual(await discord.fetchInvite('zzz'), { ok: false, reason: 'unavailable' });
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    assert.deepEqual(await discord.fetchInvite('zzz'), { ok: false, reason: 'unavailable' });
  });
});
