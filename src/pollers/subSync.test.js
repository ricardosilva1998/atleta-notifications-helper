'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const { PermissionFlagsBits: P } = require('discord.js');

const SUBSYNC_FILE = path.join(__dirname, 'subSync.js');
const GUILD = '1485302029453627464';
const ROLE = '1485308351456870641';

let linked = [];
let guildConfigs = [];
let claimsOf = {}; // streamer id -> the servers that streamer has; any other streamer has guildConfigs
let subscribers = [];
const guildCache = new Map();

const dbStub = {
  getChannelState: () => ({ twitch_broadcaster_id: '632557806' }),
  getPollerState: () => ({}),
  updateChannelState: () => {},
  clearStreamerBroadcasterScopes: () => {},
  getLinkedUsers: () => linked,
  getGuildsForStreamer: (id) => (id in claimsOf ? claimsOf[id] : guildConfigs),
};
const twitchStub = {
  getSubscribers: async () => subscribers,
  getUserId: async () => '632557806',
  refreshBroadcasterToken: async () => 'fresh-token',
};

const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === SUBSYNC_FILE) {
    if (request === '../config') return {};
    if (request === '../db') return dbStub;
    if (request === '../services/twitch') return twitchStub;
    if (request === '../discord') return { client: { guilds: { cache: guildCache } } };
  }
  return origLoad(request, parent, isMain);
};
const subSync = require('./subSync');
Module._load = origLoad;

const streamer = { id: 13, twitch_username: 'andre_vilela_', broadcaster_access_token: 'tok', broadcaster_token_expires_at: Date.now() + 3600_000 };

function fakeMember(id, username, roleIds) {
  const roles = new Set(roleIds);
  const changes = [];
  return {
    id, changes, user: { username },
    roles: {
      cache: { has: (roleId) => roles.has(roleId) },
      async add(role) { roles.add(role.id); changes.push(`+${role.id}`); },
      async remove(role) { roles.delete(role.id); changes.push(`-${role.id}`); },
    },
  };
}

// The production-like setup: a plain "Sub" role below the bot's highest role.
const EVERYDAY = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AddReactions | P.Connect | P.Speak;
let role, members;
function setGuild({ position = 3, permissions = EVERYDAY, managed = false, botTop = 10, withRole = true } = {}) {
  role = { id: ROLE, guild: { id: GUILD }, position, managed, permissions: { bitfield: permissions } };
  guildCache.set(GUILD, {
    id: GUILD, name: 'Pit Lane',
    roles: { cache: new Map(withRole ? [[ROLE, role]] : []) },
    members: {
      me: { roles: { highest: { position: botTop } } },
      async fetch(userId) {
        if (!members[userId]) throw new Error('Unknown Member');
        return members[userId];
      },
    },
  });
}

async function run(who = streamer) {
  const lines = [];
  const { log, error, warn } = console;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  try { await subSync.checkStreamer(who); } finally { console.log = log; console.error = error; console.warn = warn; }
  return lines;
}

beforeEach(async () => {
  // The notes about refused roles are kept for the life of the process: a cycle
  // of a streamer with no servers forgets this streamer's, so no test sees another's.
  claimsOf = { [streamer.id]: [] };
  await run();
  claimsOf = {};
  guildCache.clear();
  subscribers = [{ user_id: 'tw-1001' }];
  linked = [
    { discord_user_id: '800000000000000001', twitch_user_id: 'tw-1001', twitch_username: 'twitch_subber' },
    { discord_user_id: '800000000000000002', twitch_user_id: 'tw-1002', twitch_username: 'twitch_lurker' },
  ];
  members = {
    '800000000000000001': fakeMember('800000000000000001', 'discord_subber', []),
    '800000000000000002': fakeMember('800000000000000002', 'discord_lurker', [ROLE]),
  };
  guildConfigs = [{ guild_id: GUILD, sub_sync_enabled: 1, sub_role_id: ROLE }];
});

test('a plain sub role is given to linked subs and taken from linked non-subs', async () => {
  setGuild();
  await run();
  assert.deepEqual(members['800000000000000001'].changes, [`+${ROLE}`]);
  assert.deepEqual(members['800000000000000002'].changes, [`-${ROLE}`]);
});

test('logs counts once per cycle and one line per role change, never the linked accounts', async () => {
  setGuild();
  const lines = await run();
  assert.equal(lines.length, 3, lines.join('\n'));
  assert.match(lines[0], /andre_vilela_: 1 subscribers, 2 linked users \(1 subscribed\), 1 server\(s\) syncing/);
  assert.match(lines[1], /\+role discord_subber in Pit Lane/);
  assert.match(lines[2], /-role discord_lurker in Pit Lane/);
  const all = lines.join('\n');
  for (const secret of ['800000000000000001', '800000000000000002', 'twitch_subber', 'twitch_lurker', 'tw-1001', 'tw-1002']) {
    assert.ok(!all.includes(secret), `logged ${secret}`);
  }

  const quiet = await run(); // nothing left to change
  assert.equal(quiet.length, 1);
});

test('a role that gained moderator permissions is left alone, and the refusal is logged once', async () => {
  setGuild({ permissions: EVERYDAY | P.KickMembers });
  const first = await run();
  const second = await run();
  assert.deepEqual(members['800000000000000001'].changes, []);
  assert.deepEqual(members['800000000000000002'].changes, [], 'not taken from members who have it either');
  assert.equal(first.filter((l) => /not usable/.test(l)).length, 1);
  assert.match(first.find((l) => /not usable/.test(l)), /privileged/);
  assert.equal(second.filter((l) => /not usable/.test(l)).length, 0);
});

test('a role above the bot, a managed role and a deleted role are skipped', async () => {
  for (const [opts, reason] of [[{ position: 10 }, 'above_bot'], [{ managed: true }, 'managed'], [{ withRole: false }, 'missing']]) {
    guildCache.clear();
    setGuild(opts);
    const lines = await run();
    assert.deepEqual(members['800000000000000001'].changes, [], reason);
    assert.ok(lines.some((l) => l.includes(reason)), `${reason}: ${lines.join(' | ')}`);
  }
});

test('sync resumes once the role is usable again, and a new refusal is logged again', async () => {
  setGuild({ permissions: P.BanMembers });
  await run();
  setGuild();
  await run();
  assert.deepEqual(members['800000000000000001'].changes, [`+${ROLE}`]);
  setGuild({ permissions: P.BanMembers });
  const lines = await run();
  assert.equal(lines.filter((l) => /not usable/.test(l)).length, 1);
});

test('the note about a refused role is forgotten once the server is no longer claimed, so a new claim is told about it again', async () => {
  const refusedNotes = (lines) => lines.filter((l) => /not usable/.test(l)).length;
  setGuild({ permissions: P.BanMembers });
  assert.equal(refusedNotes(await run()), 1);
  assert.equal(refusedNotes(await run()), 0, 'one note while the server stays claimed');

  guildConfigs = []; // the streamer released the server
  await run();

  guildConfigs = [{ guild_id: GUILD, sub_sync_enabled: 1, sub_role_id: ROLE }]; // and claimed it again, with the same role
  assert.equal(refusedNotes(await run()), 1, 'the first refusal of the new claim is logged');
});

test('a server the streamer still has keeps its note, even with sync switched off there', async () => {
  const refusedNotes = (lines) => lines.filter((l) => /not usable/.test(l)).length;
  setGuild({ permissions: P.BanMembers });
  assert.equal(refusedNotes(await run()), 1);

  guildConfigs = [{ guild_id: GUILD, sub_sync_enabled: 0, sub_role_id: ROLE }];
  await run();
  guildConfigs = [{ guild_id: GUILD, sub_sync_enabled: 1, sub_role_id: ROLE }];
  assert.equal(refusedNotes(await run()), 0, 'still claimed throughout: no second note for the same refusal');
});

test('another streamer\'s cycle forgets nothing of this streamer\'s notes', async () => {
  const refusedNotes = (lines) => lines.filter((l) => /not usable/.test(l)).length;
  setGuild({ permissions: P.BanMembers });
  assert.equal(refusedNotes(await run()), 1);

  claimsOf[14] = []; // streamer 14 has no servers at all
  await run({ ...streamer, id: 14, twitch_username: 'someone_else' });

  assert.equal(refusedNotes(await run()), 0, 'streamer 13\'s note is still there');
});
