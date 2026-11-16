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
      this.options = {};
    }
    isReady() { return fake.ready; }
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'discord.js' && parent && parent.filename === DISCORD_FILE) {
      const flags = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'AttachFiles', 'ReadMessageHistory', 'ManageChannels', 'ManageRoles'];
      return {
        Client, GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildVoiceStates: 4, MessageContent: 8 }, EmbedBuilder: class {},
        IntentsBitField: class { constructor(list) { this.list = list; } freeze() { return this; } },
        ChannelType: { GuildVoice: 2, GuildCategory: 4 },
        PermissionFlagsBits: Object.fromEntries(flags.map((f, i) => [f, 1 << i])),
      };
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

describe('the coaching room helpers', () => {
  const CATEGORY = '323456789012345678';
  const category = (have, over = {}) => ({ id: CATEGORY, type: 4, guildId: GUILD, permissionsFor: () => ({ has: (flag) => have.includes(flag) }), ...over });
  const ALL = [1, 2, 4, 8, 16, 32, 64, 128]; // the fake's flags: all of them
  function guildWith(cat, { manageRoles = true } = {}) {
    return {
      members: { me: { permissions: { has: () => manageRoles } } },
      channels: { fetch: async (id) => { if (id === CATEGORY && cat) return cat; const e = new Error('Unknown Channel'); e.code = 10003; throw e; } },
    };
  }

  test('checkCategory names each missing permission, including Manage Roles in the server', async () => {
    fake.guilds.set(GUILD, guildWith(category(ALL)));
    assert.deepEqual(await discord.checkCategory(GUILD, CATEGORY), { ok: true });

    fake.guilds.set(GUILD, guildWith(category(ALL.filter((f) => f !== 64 && f !== 16)), { manageRoles: false }));
    assert.deepEqual(await discord.checkCategory(GUILD, CATEGORY), { ok: false, reason: 'permissions', missing: ['manage_channels', 'attach_files', 'manage_roles'] });
  });

  test('checkCategory: not a category, another server\'s, a bad id, unknown channel, and Discord not ready', async () => {
    fake.guilds.set(GUILD, guildWith(category(ALL, { type: 0 })));
    assert.equal((await discord.checkCategory(GUILD, CATEGORY)).reason, 'not_found');
    fake.guilds.set(GUILD, guildWith(category(ALL, { guildId: '999999999999999999' })));
    assert.equal((await discord.checkCategory(GUILD, CATEGORY)).reason, 'not_found');
    assert.equal((await discord.checkCategory(GUILD, 'nope')).reason, 'not_found');
    fake.guilds.set(GUILD, guildWith(null));
    assert.equal((await discord.checkCategory(GUILD, CATEGORY)).reason, 'not_found');
    fake.ready = false;
    assert.equal((await discord.checkCategory(GUILD, CATEGORY)).reason, 'unknown');
  });

  test('a room call with Discord not ready throws not_ready, and deleting something already gone is not an error', async () => {
    fake.ready = false;
    await assert.rejects(discord.createRole(GUILD, 'x'), /not_ready/);
    fake.ready = true;
    fake.guilds.set(GUILD, { roles: { delete: async () => { throw codeError(10011); } }, channels: { delete: async () => { throw codeError(10003); } } });
    await discord.deleteRole(GUILD, '423456789012345678');
    await discord.deleteChannel(GUILD, '423456789012345678');
    fake.guilds.set(GUILD, { roles: { delete: async () => { throw codeError(50013); } } });
    await assert.rejects(discord.deleteRole(GUILD, '423456789012345678'), (e) => e.code === 50013);
  });

  test('attachments are fetched only from Discord\'s own hosts, over https, and never past the size limit', async () => {
    const bodyOf = (...chunks) => ({ ok: true, status: 200, body: (async function* () { for (const c of chunks) yield c; })() });
    let asked = [];
    global.fetch = async (url) => { asked.push(String(url)); return bodyOf(Buffer.alloc(6), Buffer.alloc(6)); };
    for (const url of ['https://evil.example/a.png', 'http://cdn.discordapp.com/a.png', 'https://cdn.discordapp.com.evil.example/a.png', 'not a url']) {
      await assert.rejects(discord.downloadAttachment(url, { maxBytes: 100 }), /bad_/);
    }
    assert.deepEqual(asked, []);
    const ok = await discord.downloadAttachment('https://cdn.discordapp.com/attachments/1/2/a.png', { maxBytes: 100 });
    assert.equal(ok.length, 12);
    await assert.rejects(discord.downloadAttachment('https://media.discordapp.net/a.png', { maxBytes: 10 }), /too_big/);
    global.fetch = async () => ({ ok: false, status: 404, body: null });
    await assert.rejects(discord.downloadAttachment('https://cdn.discordapp.com/a.png', { maxBytes: 10 }), /status_404/);
  });
});

describe('renameRole and renameChannel', () => {
  const ROLE = '323456789012345678';
  const CHANNEL = '423456789012345678';
  test('edit only the name, through the guild, and ignore an id that is not a snowflake', async () => {
    const edits = [];
    fake.guilds.set(GUILD, {
      id: GUILD,
      roles: { edit: (id, opts) => { edits.push(['role', id, opts]); return Promise.resolve({}); } },
      channels: { edit: (id, opts) => { edits.push(['channel', id, opts]); return Promise.resolve({}); } },
    });
    await discord.renameRole(GUILD, ROLE, 'coaching-x-2026-11-07');
    await discord.renameChannel(GUILD, CHANNEL, 'coaching-x-2026-11-07');
    await discord.renameRole(GUILD, 'nope', 'x');
    await discord.renameChannel(GUILD, 'nope', 'x');
    assert.deepEqual(edits.map((e) => [e[0], e[1], e[2].name]), [['role', ROLE, 'coaching-x-2026-11-07'], ['channel', CHANNEL, 'coaching-x-2026-11-07']]);
  });

  test('a refusal from Discord, or a server the bot is not in, is thrown to the caller', async () => {
    fake.guilds.set(GUILD, { id: GUILD, roles: { edit: () => Promise.reject(codeError(50013)) }, channels: { edit: () => Promise.reject(codeError(10003)) } });
    await assert.rejects(discord.renameRole(GUILD, ROLE, 'x'), { code: 50013 });
    await assert.rejects(discord.renameChannel(GUILD, CHANNEL, 'x'), { code: 10003 });
    fake.guilds.clear();
    await assert.rejects(discord.renameChannel(GUILD, CHANNEL, 'x'));
  });
});
