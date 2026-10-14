'use strict';

// The settings table behind POST /dashboard/settings, with a fake database: what each key accepts, where it
// is written, what it needs first, and which follow-ups run. All ids are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS, ERRORS, BATCH_MAX, save } = require('./dashboardSettings');

const GUILD = '600000000000000001';
const OTHER_GUILD = '600000000000000002';

function fakeDb({ streamer = {}, guilds = {}, watchers = [], sponsorMessages = [] } = {}) {
  const row = { id: 1, chatbot_enabled: 1, overlay_enabled: 0, twitch_username: 'synthetic_streamer', paypal_email: null, ...streamer };
  const writes = [];
  const recordInto = (name) => (id, config) => { writes.push([name, id, config]); Object.assign(row, config); };
  return {
    writes,
    getStreamerById: (id) => (id === row.id ? { ...row } : null),
    getGuildConfig: (guildId, streamerId) => (streamerId === row.id && guilds[guildId] ? { guild_id: guildId, streamer_id: streamerId, ...guilds[guildId] } : null),
    getOwnWatcher: (guildId, streamerId, login) => watchers.find((w) => w.guild_id === guildId && streamerId === row.id && w.twitch_username === String(login).toLowerCase()) || null,
    getSponsorMessages: (streamerId) => (streamerId === row.id ? sponsorMessages : []),
    runInTransaction: (fn) => { writes.push(['transaction']); return fn(); },
    updateChatbotConfig: recordInto('updateChatbotConfig'),
    updateBuiltinCommands: recordInto('updateBuiltinCommands'),
    updateModerationConfig: recordInto('updateModerationConfig'),
    updateOverlayConfig: recordInto('updateOverlayConfig'),
    updateDonationSettings: recordInto('updateDonationSettings'),
    setSponsorChatSetting: (id, column, value) => { writes.push(['setSponsorChatSetting', id, column, value]); row[column] = value; },
    setGuildSwitch: (guildId, id, column, value) => { writes.push(['setGuildSwitch', guildId, id, column, value]); return true; },
    setWatcherNotify: (watcherId, id, column, value) => { writes.push(['setWatcherNotify', watcherId, id, column, value]); return true; },
    setSponsorMessageEnabled: (messageId, id, value) => { writes.push(['setSponsorMessageEnabled', messageId, id, value]); return true; },
  };
}

function run(body, setup = {}) {
  const db = fakeDb(setup);
  const followUps = [];
  const result = save(db.getStreamerById(1), body, { db, followUps: { run: (info) => followUps.push(info) } });
  return { result, writes: db.writes.filter(([name]) => name !== 'transaction'), followUps };
}

describe('the settings a card may save', () => {
  test('are exactly these 57 keys', () => {
    assert.deepEqual(Object.keys(SETTINGS).sort(), [
      'chat_bits_enabled', 'chat_bits_template', 'chat_donation_enabled', 'chat_donation_template',
      'chat_follow_enabled', 'chat_follow_template', 'chat_giftsub_enabled', 'chat_giftsub_template',
      'chat_raid_enabled', 'chat_raid_template', 'chat_sub_enabled', 'chat_sub_template', 'chatbot_enabled',
      'cmd_8ball_enabled', 'cmd_accountage_enabled', 'cmd_coinflip_enabled', 'cmd_followage_enabled',
      'cmd_hug_enabled', 'cmd_love_enabled', 'cmd_quote_enabled', 'cmd_roast_enabled', 'cmd_roll_enabled',
      'cmd_rps_enabled', 'cmd_slap_enabled', 'cmd_subage_enabled', 'cmd_uptime_enabled', 'cp_rewards_enabled',
      'donation_page_enabled', 'milestones_enabled', 'mod_banned_words_enabled', 'mod_caps_enabled',
      'mod_emote_spam_enabled', 'mod_link_protection_enabled', 'mod_repetition_enabled', 'mod_symbol_spam_enabled',
      'notify_clips', 'notify_live', 'overlay_bits_duration', 'overlay_bits_enabled', 'overlay_donation_duration',
      'overlay_donation_enabled', 'overlay_enabled', 'overlay_follow_duration', 'overlay_follow_enabled',
      'overlay_giveaway_duration', 'overlay_giveaway_enabled', 'overlay_raid_duration', 'overlay_raid_enabled',
      'overlay_sub_duration', 'overlay_sub_enabled', 'overlay_volume', 'recap_enabled',
      'sponsor_chat_interval_minutes', 'sponsor_message_enabled', 'sponsor_send_chat', 'sub_sync_enabled',
      'weekly_highlights_enabled',
    ]);
    assert.equal(BATCH_MAX, 20);
    for (const { status, text } of Object.values(ERRORS)) {
      assert.ok([400, 404, 409].includes(status));
      assert.match(text, /^dashboard\.settings\.error\./);
    }
  });
});

describe('a single switch', () => {
  test('is written to its one column and answered as 1 or 0', () => {
    const { result, writes, followUps } = run({ key: 'chat_follow_enabled', value: false });
    assert.deepEqual(result, { ok: true, values: { chat_follow_enabled: 0 } });
    assert.deepEqual(writes, [['updateChatbotConfig', 1, { chat_follow_enabled: 0 }]]);
    assert.equal(followUps.length, 1);
    assert.deepEqual([...followUps[0].steps], []);
  });

  test('accepts the values a switch can have, and refuses every other value with nothing written', () => {
    for (const [value, stored] of [[true, 1], ['1', 1], ['on', 1], [0, 0], ['false', 0], ['', 0]]) {
      assert.deepEqual(run({ key: 'mod_caps_enabled', value }).result.values, { mod_caps_enabled: stored }, JSON.stringify(value));
    }
    for (const value of ['yes', 2, [], {}, null, undefined]) {
      const { result, writes } = run({ key: 'mod_caps_enabled', value });
      assert.deepEqual(result, { ok: false, code: 'invalid', status: 400 }, JSON.stringify(value));
      assert.deepEqual(writes, []);
    }
  });

  test('a key that is not on the list, or no key, is refused', () => {
    for (const body of [{ key: 'paypal_email', value: 'x@example.test' }, { key: '__proto__', value: 1 }, { value: 1 }, null, 'text', { changes: [] }]) {
      assert.deepEqual(run(body).result, { ok: false, code: 'invalid', status: 400 }, JSON.stringify(body));
    }
  });
});

describe('numbers and texts', () => {
  test('an alert\'s seconds are whole seconds in its range (the giveaway winner up to 60)', () => {
    assert.deepEqual(run({ key: 'overlay_follow_duration', value: '12' }).result.values, { overlay_follow_duration: 12 });
    assert.deepEqual(run({ key: 'overlay_giveaway_duration', value: 60 }).result.values, { overlay_giveaway_duration: 60 });
    for (const value of [0, 31, 8.5, '', 'abc']) {
      assert.equal(run({ key: 'overlay_follow_duration', value }).result.code, 'invalid', JSON.stringify(value));
    }
  });

  test('the volume is 0 to 1, the sponsor interval 1 to 1440 minutes', () => {
    assert.deepEqual(run({ key: 'overlay_volume', value: 0.24 }).result.values, { overlay_volume: 0.24 });
    assert.equal(run({ key: 'overlay_volume', value: 1.5 }).result.code, 'invalid');
    assert.deepEqual(run({ key: 'sponsor_chat_interval_minutes', value: 60 }).result.values, { sponsor_chat_interval_minutes: 60 });
    assert.equal(run({ key: 'sponsor_chat_interval_minutes', value: 0 }).result.code, 'invalid');
  });

  test('a thank-you text is trimmed, required and at most 500 characters', () => {
    const { result, writes } = run({ key: 'chat_follow_template', value: '  Thanks {username}!  ' });
    assert.deepEqual(result.values, { chat_follow_template: 'Thanks {username}!' });
    assert.deepEqual(writes, [['updateChatbotConfig', 1, { chat_follow_template: 'Thanks {username}!' }]]);
    assert.deepEqual(run({ key: 'chat_follow_template', value: '   ' }).result, { ok: false, code: 'required', status: 400 });
    assert.deepEqual(run({ key: 'chat_follow_template', value: 'x'.repeat(501) }).result, { ok: false, code: 'too_long', status: 400 });
    assert.equal(run({ key: 'chat_follow_template', value: 7 }).result.code, 'invalid');
  });
});

describe('settings that need something first', () => {
  test('the tip page switches on only with a PayPal email; off always', () => {
    assert.deepEqual(run({ key: 'donation_page_enabled', value: 1 }).result, { ok: false, code: 'no_email', status: 409 });
    assert.deepEqual(run({ key: 'donation_page_enabled', value: 1 }, { streamer: { paypal_email: 'tips@example.test' } }).result.values, { donation_page_enabled: 1 });
    assert.deepEqual(run({ key: 'donation_page_enabled', value: 0 }).result.values, { donation_page_enabled: 0 });
  });

  test('a server switch needs the streamer\'s own server; sub roles also need a role', () => {
    const guilds = { [GUILD]: { sub_role_id: null } };
    assert.deepEqual(run({ key: 'recap_enabled', guildId: OTHER_GUILD, value: 1 }, { guilds }).result, { ok: false, code: 'not_found', status: 404 });
    assert.deepEqual(run({ key: 'recap_enabled', guildId: 'not-an-id', value: 1 }, { guilds }).result.code, 'not_found');
    const ok = run({ key: 'recap_enabled', guildId: GUILD, value: 1 }, { guilds });
    assert.deepEqual(ok.writes, [['setGuildSwitch', GUILD, 1, 'recap_enabled', 1]]);
    assert.deepEqual(run({ key: 'sub_sync_enabled', guildId: GUILD, value: 1 }, { guilds }).result, { ok: false, code: 'no_role', status: 409 });
    const withRole = { [GUILD]: { sub_role_id: '800000000000000001' } };
    assert.deepEqual(run({ key: 'sub_sync_enabled', guildId: GUILD, value: 1 }, { guilds: withRole }).result.values, { sub_sync_enabled: 1 });
  });

  test('go-live and clips change the watcher row of the streamer\'s own channel in that server, and need its channel to switch on', () => {
    const guilds = { [GUILD]: {}, [OTHER_GUILD]: {} };
    const watchers = [
      { id: 31, guild_id: GUILD, twitch_username: 'synthetic_streamer', live_channel_id: '700000000000000001', clips_channel_id: null },
      { id: 32, guild_id: OTHER_GUILD, twitch_username: 'synthetic_streamer', live_channel_id: '700000000000000002', clips_channel_id: null },
    ];
    const live = run({ key: 'notify_live', guildId: GUILD, value: 0 }, { guilds, watchers });
    assert.deepEqual(live.writes, [['setWatcherNotify', 31, 1, 'notify_live', 0]], 'only this server\'s row');
    assert.deepEqual(run({ key: 'notify_clips', guildId: GUILD, value: 1 }, { guilds, watchers }).result, { ok: false, code: 'no_channel', status: 409 });
    const noWatcher = { guilds: { [GUILD]: {} }, watchers: [] };
    assert.deepEqual(run({ key: 'notify_live', guildId: GUILD, value: 1 }, noWatcher).result.code, 'no_channel');
    const offWithout = run({ key: 'notify_live', guildId: GUILD, value: 0 }, noWatcher);
    assert.deepEqual(offWithout.result.values, { notify_live: 0 });
    assert.deepEqual(offWithout.writes, [], 'nothing to switch off');
  });

  test('a sponsor message switch needs the streamer\'s own message', () => {
    const sponsorMessages = [{ id: 5, message_text: 'Partner', enabled: 1 }];
    assert.deepEqual(run({ key: 'sponsor_message_enabled', id: 6, value: 0 }, { sponsorMessages }).result.code, 'not_found');
    const ok = run({ key: 'sponsor_message_enabled', id: 5, value: 0 }, { sponsorMessages });
    assert.deepEqual(ok.writes, [['setSponsorMessageEnabled', 5, 1, 0]]);
    assert.deepEqual([...ok.followUps[0].steps], ['sponsorChat']);
  });
});

describe('batches and follow-ups', () => {
  test('a batch is checked whole before anything is written: one bad change writes nothing', () => {
    const bad = run({ changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 'maybe' }] });
    assert.deepEqual(bad.result, { ok: false, code: 'invalid', status: 400 });
    assert.deepEqual(bad.writes, []);
    const good = run({ changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 0 }] });
    assert.deepEqual(good.result.values, { cmd_uptime_enabled: 1, cmd_roll_enabled: 0 });
    assert.equal(good.followUps.length, 1, 'the follow-ups run once');
    const tooMany = run({ changes: Array.from({ length: BATCH_MAX + 1 }, () => ({ key: 'cmd_uptime_enabled', value: 1 })) });
    assert.equal(tooMany.result.code, 'invalid');
  });

  test('the follow-ups get the row before and after and the steps the keys name', () => {
    const chatbot = run({ key: 'chatbot_enabled', value: 0 });
    assert.equal(chatbot.followUps[0].before.chatbot_enabled, 1);
    assert.equal(chatbot.followUps[0].after.chatbot_enabled, 0);
    assert.deepEqual([...chatbot.followUps[0].steps], ['connections']);
    assert.deepEqual([...run({ key: 'overlay_enabled', value: 1 }).followUps[0].steps].sort(), ['connections', 'overlay']);
    assert.deepEqual([...run({ key: 'overlay_raid_duration', value: 10 }).followUps[0].steps], ['overlay']);
    assert.deepEqual([...run({ key: 'sponsor_chat_interval_minutes', value: 30 }).followUps[0].steps], ['sponsorChat']);
  });
});
