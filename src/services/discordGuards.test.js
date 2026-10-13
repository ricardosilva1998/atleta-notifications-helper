'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');

const {
  subRoleEligibility, roleFacts, PRIVILEGED_ROLE_PERMISSIONS,
  isChannelInGuild, canManageGuild,
  clampWelcomeMessage, WELCOME_MESSAGE_MAX,
  BOT_INVITE_PERMISSIONS, botInviteUrl,
} = require('./discordGuards');

const GUILD = '1485302029453627464';

// A role as roleFacts() reports it; below a bot whose top role sits at 10.
function role(overrides = {}) {
  return { id: '1485308351456870641', guildId: GUILD, managed: false, position: 3, permissions: 0n, ...overrides };
}

describe('subRoleEligibility', () => {
  test('a plain role below the bot can be the sub role', () => {
    assert.deepEqual(subRoleEligibility(role(), 10), { ok: true });
  });

  test('a typical "Sub" role with everyday member permissions stays usable', () => {
    const everyday = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AddReactions | P.EmbedLinks
      | P.AttachFiles | P.UseExternalEmojis | P.Connect | P.Speak | P.Stream | P.ChangeNickname | P.CreateInstantInvite;
    assert.deepEqual(subRoleEligibility(role({ permissions: everyday }), 10), { ok: true });
  });

  test('refuses a missing role, @everyone and integration-managed roles', () => {
    assert.deepEqual(subRoleEligibility(null, 10), { ok: false, reason: 'missing' });
    assert.deepEqual(subRoleEligibility(role({ id: GUILD, position: 0 }), 10), { ok: false, reason: 'everyone' });
    assert.deepEqual(subRoleEligibility(role({ managed: true }), 10), { ok: false, reason: 'managed' });
  });

  test('refuses a role at or above the bot\'s highest role', () => {
    assert.deepEqual(subRoleEligibility(role({ position: 10 }), 10), { ok: false, reason: 'above_bot' });
    assert.deepEqual(subRoleEligibility(role({ position: 11 }), 10), { ok: false, reason: 'above_bot' });
    assert.deepEqual(subRoleEligibility(role({ position: 0 }), -1), { ok: false, reason: 'above_bot' }, 'unknown bot position');
    assert.deepEqual(subRoleEligibility(role(), undefined), { ok: false, reason: 'above_bot' });
  });

  test('refuses a role carrying any moderator or admin permission', () => {
    assert.equal(PRIVILEGED_ROLE_PERMISSIONS.length, 9);
    for (const name of PRIVILEGED_ROLE_PERMISSIONS) {
      const perms = P.SendMessages | P[name];
      assert.deepEqual(subRoleEligibility(role({ permissions: perms }), 10), { ok: false, reason: 'privileged' }, name);
    }
  });

  test('accepts the permissions bitfield as a decimal string', () => {
    assert.deepEqual(subRoleEligibility(role({ permissions: String(P.SendMessages) }), 10), { ok: true });
    assert.deepEqual(subRoleEligibility(role({ permissions: String(P.Administrator) }), 10), { ok: false, reason: 'privileged' });
  });

  test('roleFacts reads a discord.js role', () => {
    const djsRole = { id: '7', guild: { id: GUILD }, managed: false, position: 2, permissions: { bitfield: P.SendMessages } };
    assert.deepEqual(roleFacts(djsRole), { id: '7', guildId: GUILD, managed: false, position: 2, permissions: P.SendMessages });
    assert.equal(roleFacts(null), null);
  });
});

describe('isChannelInGuild', () => {
  test('matches only a channel of the same server', () => {
    assert.equal(isChannelInGuild({ id: '1', guildId: GUILD }, GUILD), true);
    assert.equal(isChannelInGuild({ id: '1', guildId: '999999999999999999' }, GUILD), false);
  });

  test('refuses missing channels, DM channels and a missing server id', () => {
    assert.equal(isChannelInGuild(null, GUILD), false);
    assert.equal(isChannelInGuild({ id: '1', guildId: null }, GUILD), false);
    assert.equal(isChannelInGuild({ id: '1' }, GUILD), false);
    assert.equal(isChannelInGuild({ id: '1', guildId: GUILD }, null), false);
    assert.equal(isChannelInGuild({ id: '1', guildId: GUILD }, ''), false);
  });
});

describe('canManageGuild', () => {
  // A fake guild whose members.fetch() resolves to a member with the given
  // permission bits (absent = not a member), recording each call.
  function fakeGuild(id, permsByUser) {
    const calls = [];
    return {
      id,
      calls,
      members: {
        async fetch(arg) {
          calls.push(arg);
          const userId = typeof arg === 'string' ? arg : arg.user;
          if (!(userId in permsByUser)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
          const bits = permsByUser[userId];
          return { permissions: { has: (flag) => (bits & P.Administrator) !== 0n || (bits & flag) === flag } };
        },
      },
    };
  }

  test('true for a member with Manage Server or Administrator, false otherwise', async () => {
    const g = fakeGuild('100000000000000001', { u1: P.ManageGuild, u2: P.Administrator, u3: P.SendMessages });
    assert.equal(await canManageGuild(g, 'u1'), true);
    assert.equal(await canManageGuild(g, 'u2'), true);
    assert.equal(await canManageGuild(g, 'u3'), false);
  });

  test('false for someone who is not in the server, and for missing input', async () => {
    const g = fakeGuild('100000000000000002', {});
    assert.equal(await canManageGuild(g, 'stranger'), false);
    assert.equal(await canManageGuild(null, 'u1'), false);
    assert.equal(await canManageGuild(g, ''), false);
  });

  test('answers from a short per-user cache, and a fresh check asks Discord again', async () => {
    const g = fakeGuild('100000000000000003', { owner: P.ManageGuild });
    assert.equal(await canManageGuild(g, 'owner'), true);
    assert.equal(await canManageGuild(g, 'owner'), true);
    assert.equal(g.calls.length, 1, 'second answer came from the cache');
    assert.equal(await canManageGuild(g, 'owner', { fresh: true }), true);
    assert.equal(g.calls.length, 2);
    assert.deepEqual(g.calls[1], { user: 'owner', force: true });
  });

  test('a cached answer is per server', async () => {
    const a = fakeGuild('100000000000000004', { u9: P.ManageGuild });
    const b = fakeGuild('100000000000000005', { u9: P.SendMessages });
    assert.equal(await canManageGuild(a, 'u9'), true);
    assert.equal(await canManageGuild(b, 'u9'), false);
  });
});

describe('clampWelcomeMessage', () => {
  test('keeps a message within the limit as it is', () => {
    assert.equal(clampWelcomeMessage('Welcome!\n**Rules**'), 'Welcome!\n**Rules**');
    assert.equal(clampWelcomeMessage('x'.repeat(WELCOME_MESSAGE_MAX)).length, WELCOME_MESSAGE_MAX);
  });

  test('stays under Discord\'s 4096-character embed description limit', () => {
    assert.ok(WELCOME_MESSAGE_MAX <= 4096);
    assert.equal(clampWelcomeMessage('y'.repeat(9000)).length, WELCOME_MESSAGE_MAX);
  });

  test('counts a form-submitted line break as one character', () => {
    // Browsers count a textarea line break as one character for maxlength but submit it as \r\n.
    const typed = ('a'.repeat(99) + '\n').repeat(40); // 4000 characters as typed
    const submitted = typed.replace(/\n/g, '\r\n');
    assert.equal(clampWelcomeMessage(submitted), typed);
  });

  test('never cuts an emoji in half', () => {
    const text = 'z'.repeat(WELCOME_MESSAGE_MAX - 1) + '\u{1F3C1}';
    assert.equal(clampWelcomeMessage(text), 'z'.repeat(WELCOME_MESSAGE_MAX - 1));
  });

  test('anything that is not text becomes empty', () => {
    assert.equal(clampWelcomeMessage(undefined), '');
    assert.equal(clampWelcomeMessage(['a', 'b']), '');
  });
});

describe('bot invite', () => {
  test('asks for exactly what the features use, never Administrator', () => {
    const expected = P.ViewChannel | P.SendMessages | P.EmbedLinks | P.AttachFiles | P.ReadMessageHistory | P.ManageRoles;
    assert.equal(BOT_INVITE_PERMISSIONS, expected);
    assert.equal(BOT_INVITE_PERMISSIONS.toString(), '268553216');
    assert.equal(BOT_INVITE_PERMISSIONS & P.Administrator, 0n);
  });

  test('the invite URL carries the permissions and scopes but no state', () => {
    const url = new URL(botInviteUrl('1480000000000000000'));
    assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(url.searchParams.get('client_id'), '1480000000000000000');
    assert.equal(url.searchParams.get('permissions'), '268553216');
    assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
    assert.equal(url.searchParams.has('state'), false);
  });
});
