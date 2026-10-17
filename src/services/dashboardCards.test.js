'use strict';

// The working cards' states (services/dashboardCards.js) from synthetic data: every card in the states the
// dashboard meets. No database, Discord or Twitch: the input is what GET /dashboard gathers.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildCards, cardTexts, pollsStatus, pollsSetup, ORDER } = require('./dashboardCards');

const G1 = '600000000000000001';
const G2 = '600000000000000002';

// One claimed server as discordNotificationsCard() gives it (with Task 13's fields).
const server = (over = {}) => ({
  guildId: G1, name: 'Synthetic Server', icon: null, botPresent: true, url: `/dashboard/guild/${G1}`,
  goLive: { state: 'on', where: '#live' }, clips: { state: 'off', where: null }, recaps: 'off', milestones: 'off', highlights: 'off', subRoles: 'on',
  switches: { goLive: true, clips: false, recaps: false, milestones: false, highlights: false, subRoles: true },
  liveWhere: '#live', clipsWhere: null, hasLiveChannel: true, hasClipsChannel: false, hasSubRole: true,
  ...over,
});

// What gatherCards() hands the Tracking card: the Tracking state (no goal, every tracker on with no value) and the links.
function trackingInput(over = {}) {
  const base = 'https://atleta.example/overlay';
  const ids = ['latest_follower', 'latest_sub', 'latest_tip', 'latest_raid', 'latest_bits', 'top_tipper'];
  return {
    goals: { follow: { goal: null, timeZone: null, hours: null, history: [] }, sub: { goal: null, timeZone: null, hours: null, history: [] } },
    trackers: Object.fromEntries(ids.map((id) => [id, { enabled: true, color: '#9146FF', ownColor: false, value: null }])),
    currency: 'EUR',
    notAffiliate: false,
    links: {
      goals: { follow: `${base}/goal/followers/tok?lang=en`, sub: `${base}/goal/subs/tok?lang=en` },
      trackers: Object.fromEntries(ids.map((id) => [id, `${base}/tracker/${id}/tok?lang=en`])),
    },
    ...over,
  };
}

function input(over = {}) {
  const streamer = {
    id: 1, twitch_user_id: '1001', twitch_username: 'synthetic_channel', chatbot_enabled: 1,
    chat_follow_enabled: 1, chat_follow_template: 'Welcome, {username}!', chat_sub_enabled: 1, chat_sub_template: 'Thanks {username}',
    chat_giftsub_enabled: 0, chat_giftsub_template: null, chat_bits_enabled: 1, chat_bits_template: 'Bits from {username}',
    chat_donation_enabled: 1, chat_donation_template: 'Tip of {amount}', chat_raid_enabled: 1, chat_raid_template: 'Raid of {viewers}',
    overlay_enabled: 1, overlay_follow_enabled: 1, overlay_sub_enabled: 1, overlay_bits_enabled: 0, overlay_donation_enabled: 1,
    overlay_raid_enabled: 1, overlay_giveaway_enabled: 1, overlay_follow_duration: 8, overlay_sub_duration: 10, overlay_bits_duration: 10,
    overlay_donation_duration: 12, overlay_raid_duration: 7, overlay_giveaway_duration: 60, overlay_volume: 0.24,
    cmd_followage_enabled: 1, mod_link_protection_enabled: 1, sponsor_send_chat: 1, sponsor_chat_interval_minutes: 15,
    paypal_email: 'tips@example.test', donation_page_enabled: 1, donation_currency: 'EUR',
    cp_rewards_enabled: 1, cp_affiliate_status: 'ok', multistream_enabled: 0,
    polls_chat_enabled: 1, poll_start_template: 'Poll: {title}', poll_end_template: 'Closed: {winner}',
    prediction_start_template: 'Prediction: {title}', prediction_lock_template: 'Locked: {title}', prediction_end_template: '{outcome} wins',
    prediction_cancel_template: '', shoutout_command_enabled: 1, shoutout_raid_enabled: 1, shoutout_raid_min_viewers: 5,
    shoutout_template: 'Go check out {name}! They were last streaming {game}: {link}',
    ...(over.streamer || {}),
  };
  return {
    features: { overlays: true },
    now: Date.parse('2026-10-14T12:00:00Z'),
    appUrl: 'https://atleta.example',
    bot: { connected: true, moderator: true, username: 'atleta_bot' },
    overlay: { url: 'https://atleta.example/overlay/synthetic-token', open: true },
    discord: { twitchLinked: true, announcing: 1, needsAuth: false, authAction: 'enable', servers: [server()] },
    commands: [],
    bannedWords: { total: 0, regex: 0 },
    modActionsThisWeek: 0,
    sponsorMessages: [],
    tips: { recent: [], count90d: 0 },
    tipGoal: null,
    rewards: [],
    rewardsAccess: { hasScope: true },
    giveaway: null,
    spotifyConnected: true,
    multistreamAvailable: false,
    pollTemplates: [],
    polls: { hasScope: true, live: { poll: null, prediction: null, serverNow: Date.parse('2026-10-14T12:00:00Z') }, barUrl: 'https://atleta.example/overlay/poll/synthetic-token?lang=en' },
    tracking: trackingInput(),
    ...over,
    streamer,
  };
}
const build = (over) => buildCards(input(over));
const keyOf = (status) => status && status.key;

describe('the cards and their order', () => {
  test('thirteen cards in reading order while the overlay features are on', () => {
    assert.deepEqual(ORDER, ['chatbot', 'discord', 'overlay', 'tracking', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'rewards', 'spotify']);
    assert.deepEqual(build().order, ORDER);
    assert.equal(build().chatbotOn, true);
  });

  test('without the overlay features the OBS overlay, Tracking and rewards cards are left out; Multistream comes last while the relay is set up', () => {
    const off = build({ features: { overlays: false } });
    assert.deepEqual(off.order, ['chatbot', 'discord', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'spotify']);
    assert.equal(off.overlay, undefined);
    assert.equal(off.tracking, undefined);
    assert.equal(off.rewards, undefined);
    const relay = build({ multistreamAvailable: true, streamer: { multistream_enabled: 1 } });
    assert.equal(relay.order.at(-1), 'multistream');
    assert.equal(keyOf(relay.multistream.status), 'dashboard.cards.multistream.active');
  });
});

describe('Chatbot', () => {
  test('online in the channel, with the six thank-you messages and how many are on', () => {
    const card = build().chatbot;
    assert.equal(card.setup, null);
    assert.deepEqual(card.status, { key: 'cards.chatbot.status.online', params: { channel: 'synthetic_channel' }, tone: 'ok' });
    assert.deepEqual(card.thankYous.map((ty) => [ty.event, ty.label, ty.switchKey, ty.textKey, ty.on]), [
      ['follow', 'cards.events.follow', 'chat_follow_enabled', 'chat_follow_template', true],
      ['sub', 'cards.events.sub', 'chat_sub_enabled', 'chat_sub_template', true],
      ['giftsub', 'cards.events.giftsub', 'chat_giftsub_enabled', 'chat_giftsub_template', false],
      ['bits', 'cards.events.bits', 'chat_bits_enabled', 'chat_bits_template', true],
      ['donation', 'cards.events.donation', 'chat_donation_enabled', 'chat_donation_template', true],
      ['raid', 'cards.events.raid', 'chat_raid_enabled', 'chat_raid_template', true],
    ]);
    assert.equal(card.thankYous[0].text, 'Welcome, {username}!');
    assert.equal(card.thankYous[2].text, '', 'no message saved');
    assert.deepEqual(card.thankYous[4].vars, ['{username}', '{amount}', '{currency}', '{message}']);
    assert.deepEqual(card.counts.thankYous, { key: 'cards.common.nOfM', params: { on: 5, total: 6 } });
  });

  test('off; connecting while the bot\'s chat connection is down; Twitch to link first', () => {
    const off = build({ streamer: { chatbot_enabled: 0 } });
    assert.deepEqual(off.chatbot.status, { key: 'cards.chatbot.status.off', params: {}, tone: 'off' });
    assert.equal(off.chatbotOn, false);
    assert.deepEqual(build({ bot: { connected: false, moderator: null, username: 'atleta_bot' } }).chatbot.status, { key: 'cards.chatbot.status.connecting', params: {}, tone: 'warn' });
    const unlinked = build({ streamer: { twitch_user_id: null } }).chatbot;
    assert.equal(unlinked.setup, 'linkTwitch');
    assert.deepEqual(unlinked.status, { key: 'cards.chatbot.status.noTwitch', params: {}, tone: 'warn' });
  });
});

describe('Discord notifications', () => {
  const discord = (over) => ({ twitchLinked: true, announcing: 0, needsAuth: false, authAction: 'enable', servers: [], ...over });

  test('Twitch to link first; with no server, a server to add', () => {
    const unlinked = build({ discord: discord({ twitchLinked: false }) }).discord;
    assert.deepEqual([unlinked.setup, unlinked.status], ['linkTwitch', { key: 'dashboard.cards.discord.statusNoTwitch', params: {}, tone: 'warn' }]);
    const none = build({ discord: discord() }).discord;
    assert.deepEqual([none.setup, keyOf(none.status), none.servers], ['addServer', 'dashboard.cards.discord.statusNoServer', []]);
  });

  test('a server: six switches, what each stores, where the posts go and the server page tab that fixes what is missing', () => {
    const card = build().discord;
    assert.equal(card.setup, null);
    assert.deepEqual(card.status, { key: 'dashboard.cards.discord.statusAll', params: {}, tone: 'ok' });
    const [s] = card.servers;
    assert.deepEqual([s.guildId, s.name, s.botPresent, s.url], [G1, 'Synthetic Server', true, `/dashboard/guild/${G1}`]);
    assert.deepEqual(s.switches.map((sw) => [sw.key, sw.label, sw.on, sw.fix]), [
      ['notify_live', 'dashboard.cards.discord.goLive', true, 'twitch'],
      ['notify_clips', 'dashboard.cards.discord.clips', false, 'twitch'],
      ['recap_enabled', 'dashboard.cards.discord.recaps', false, 'twitch'],
      ['milestones_enabled', 'dashboard.cards.discord.milestones', false, 'twitch'],
      ['weekly_highlights_enabled', 'dashboard.cards.discord.highlights', false, 'twitch'],
      ['sub_sync_enabled', 'dashboard.cards.discord.subRoles', true, 'discord'],
    ]);
    assert.deepEqual(s.switches[0].hint, { key: 'cards.discord.inChannel', params: { channel: '#live' } });
    assert.deepEqual(s.switches[1].hint, { key: 'cards.discord.pickChannel', params: {}, warn: true }, 'no clips channel yet');
    assert.deepEqual(s.switches[2].hint, { key: 'cards.discord.recapsHint', params: {} });
  });

  test('what is missing is said under its switch: a go-live channel, the Twitch authorization, a role, a digest that is not this streamer\'s', () => {
    const missing = server({
      switches: { goLive: false, clips: false, recaps: true, milestones: true, highlights: true, subRoles: true },
      liveWhere: null, hasLiveChannel: false, highlights: 'off', subRoles: 'wait',
    });
    const [s] = build({ discord: discord({ needsAuth: true, authAction: 'reconnect', servers: [missing] }) }).discord.servers;
    const hint = (key) => s.switches.find((sw) => sw.key === key).hint;
    assert.deepEqual(hint('notify_live'), { key: 'cards.discord.pickChannel', params: {}, warn: true });
    assert.deepEqual(hint('recap_enabled'), { key: 'cards.discord.needsLiveChannel', params: {}, warn: true });
    assert.deepEqual(hint('milestones_enabled'), { key: 'cards.discord.needsLiveChannel', params: {}, warn: true });
    assert.deepEqual(hint('weekly_highlights_enabled'), { key: 'cards.discord.notPosted', params: {}, warn: true });
    assert.deepEqual(hint('sub_sync_enabled'), { key: 'dashboard.cards.discord.wait', params: {}, warn: true });

    const waiting = server({ switches: { ...server().switches, milestones: true }, milestones: 'wait' });
    const [w] = build({ discord: discord({ servers: [waiting] }) }).discord.servers;
    assert.deepEqual(w.switches[3].hint, { key: 'dashboard.cards.discord.wait', params: {}, warn: true });

    const noRole = server({ hasSubRole: false, subRoles: 'off' });
    const [r] = build({ discord: discord({ servers: [noRole] }) }).discord.servers;
    assert.deepEqual(r.switches[5].hint, { key: 'cards.discord.pickRole', params: {}, warn: true });

    const hidden = server({ liveWhere: null });
    const [h] = build({ discord: discord({ servers: [hidden] }) }).discord.servers;
    assert.deepEqual(h.switches[0].hint, { key: 'cards.discord.channelUnknown', params: {} }, 'a channel the bot cannot see is not named');
  });

  test('several servers: how many announce; none announcing is amber', () => {
    const two = build({ discord: discord({ announcing: 1, servers: [server(), server({ guildId: G2, botPresent: false })] }) }).discord;
    assert.deepEqual(two.status, { key: 'dashboard.cards.discord.statusSome', params: { count: 1, total: 2 }, tone: 'ok' });
    assert.deepEqual(two.servers.map((s) => [s.guildId, s.botPresent]), [[G1, true], [G2, false]]);
    assert.deepEqual(build({ discord: discord({ announcing: 0, servers: [server()] }) }).discord.status, { key: 'dashboard.cards.discord.statusNone', params: {}, tone: 'warn' });
  });
});

describe('OBS overlay', () => {
  test('on and open in OBS: the link masked, the alerts with their seconds and test types, the volume in percent', () => {
    const card = build().overlay;
    assert.deepEqual(card.status, { key: 'cards.overlay.status.open', params: {}, tone: 'ok' });
    assert.equal(card.on, true);
    assert.equal(card.url, 'https://atleta.example/overlay/synthetic-token');
    assert.equal(card.shown, 'atleta.example/overlay/synthetic-token');
    assert.equal(card.masked, `atleta.example/overlay/${'•'.repeat(12)}`);
    assert.deepEqual(card.alerts.map((a) => [a.label, a.switchKey, a.durationKey, a.on, a.seconds, a.test]), [
      ['cards.events.follow', 'overlay_follow_enabled', 'overlay_follow_duration', true, 8, 'follow'],
      ['cards.events.sub', 'overlay_sub_enabled', 'overlay_sub_duration', true, 10, 'subscription'],
      ['cards.events.bits', 'overlay_bits_enabled', 'overlay_bits_duration', false, 10, 'bits'],
      ['cards.events.donation', 'overlay_donation_enabled', 'overlay_donation_duration', true, 12, 'donation'],
      ['cards.events.raid', 'overlay_raid_enabled', 'overlay_raid_duration', true, 7, 'raid'],
      ['cards.events.giveaway', 'overlay_giveaway_enabled', 'overlay_giveaway_duration', true, 60, 'giveaway_winner'],
    ]);
    assert.deepEqual(card.alerts.map((a) => [a.icon, a.tone, a.short]), [['i-heart', 'follow', 'cards.overlay.testName.follow'], ['i-star', 'sub', 'cards.overlay.testName.sub'], ['i-gem', 'bits', 'cards.overlay.testName.bits'], ['i-coin', 'donation', 'cards.overlay.testName.donation'], ['i-users', 'raid', 'cards.overlay.testName.raid'], ['i-gift', 'giveaway', 'cards.overlay.testName.giveaway']]);
    assert.deepEqual(card.alerts[0].choices, [5, 8, 10, 12, 15, 20, 30]);
    assert.deepEqual(card.alerts[4].choices, [5, 7, 8, 10, 12, 15, 20, 30], 'a saved 7 stays a choice');
    assert.deepEqual(card.alerts[5].choices, [5, 8, 10, 12, 15, 20, 30, 45, 60], 'the giveaway winner may stay up to 60 s');
    assert.equal(card.volume, 24);
    assert.deepEqual(card.counts.alerts, { key: 'cards.common.nOfM', params: { on: 5, total: 6 } });
  });

  test('not open in OBS, off, no link yet; no volume saved shows the default', () => {
    assert.deepEqual(build({ overlay: { url: 'https://atleta.example/overlay/x', open: false } }).overlay.status, { key: 'cards.overlay.status.notOpen', params: {}, tone: 'warn' });
    assert.deepEqual(build({ streamer: { overlay_enabled: 0 } }).overlay.status, { key: 'cards.overlay.status.off', params: {}, tone: 'off' });
    const noLink = build({ overlay: { url: null, open: false } }).overlay;
    assert.deepEqual([noLink.url, noLink.shown, noLink.masked], [null, null, null]);
    assert.equal(build({ streamer: { overlay_volume: null } }).overlay.volume, 80);
  });

  // The overlay is told these numbers through overlaySettings.wholeSeconds (overlayConfig.js): the card shows the same.
  test('a stored duration shows the seconds the overlay plays: past the longest, the longest; below one, one; whole seconds; unreadable, the default', () => {
    const seconds = (column, value) => build({ streamer: { [column]: value } }).overlay.alerts.find((a) => a.durationKey === column).seconds;
    assert.equal(seconds('overlay_follow_duration', 99), 30, 'follow stored 99: the longest, 30');
    assert.equal(seconds('overlay_follow_duration', 0), 1, 'follow stored 0: one second');
    assert.equal(seconds('overlay_sub_duration', 8.5), 8, 'sub stored 8.5: whole seconds, 8');
    assert.equal(seconds('overlay_sub_duration', null), 10, 'sub stored nothing: its own default, 10');
  });

  test('the poll bar\'s OBS link is there too, masked', () => {
    assert.deepEqual(build().overlay.pollBar, {
      url: 'https://atleta.example/overlay/poll/synthetic-token?lang=en',
      shown: 'atleta.example/overlay/poll/synthetic-token?lang=en',
      masked: `atleta.example/overlay/poll/${'•'.repeat(12)}`,
    });
  });
});

describe('Commands', () => {
  // As db.getChatCommands() gives them: chat_commands.enabled is 1 until the chatbot page switches the command off.
  const commands = ['discord', 'socials', 'setup', 'schedule', 'sim'].map((name, i) => ({ id: i + 1, command: name, response: `About ${name}`, enabled: 1, cooldown: 10 }));

  test('the commands and the built-ins that are on; four shown, the rest behind Show all', () => {
    const card = build({ commands }).commands;
    assert.equal(card.needsChatbot, true);
    assert.deepEqual(card.status, { key: 'cards.commands.status', params: { commands: 5, builtins: 1 }, tone: 'ok' });
    assert.deepEqual(card.commands.map((c) => [c.id, c.name, c.response, c.cooldown, c.on, c.extra]), [
      [1, 'discord', 'About discord', 10, true, false], [2, 'socials', 'About socials', 10, true, false], [3, 'setup', 'About setup', 10, true, false],
      [4, 'schedule', 'About schedule', 10, true, false], [5, 'sim', 'About sim', 10, true, true],
    ]);
    assert.equal(card.builtins.length, 13);
    assert.deepEqual(card.builtins.slice(0, 4).map((b) => [b.key, b.name, b.on]), [
      ['cmd_followage_enabled', '!followage', true], ['cmd_subage_enabled', '!subage', false], ['cmd_uptime_enabled', '!uptime', false], ['cmd_accountage_enabled', '!accountage', false],
    ]);
    assert.deepEqual(card.counts, { commands: { text: '5' }, builtins: { key: 'cards.common.nOfM', params: { on: 1, total: 13 } } });
  });

  test('a command switched off on the chatbot page stays in the list with its row off: the bot ignores it', () => {
    const rows = commands.map((c) => (c.command === 'setup' ? { ...c, enabled: 0 } : c));
    const card = build({ commands: rows }).commands;
    assert.deepEqual(card.commands.map((c) => [c.name, c.on]), [['discord', true], ['socials', true], ['setup', false], ['schedule', true], ['sim', true]]);
  });

  test('green only while something answers in chat: a command that is on or a built-in that is on', () => {
    const off = commands.map((c) => ({ ...c, enabled: 0 }));
    const none = { cmd_followage_enabled: 0 };
    assert.deepEqual(build({ streamer: none, commands: off }).commands.status, { key: 'cards.commands.status', params: { commands: 5, builtins: 0 }, tone: 'off' }, 'every command off and no built-in on: grey, and the numbers still count the commands');
    assert.equal(build({ commands: off }).commands.status.tone, 'ok', 'every command off but a built-in on');
    assert.equal(build({ streamer: none, commands: off.map((c, i) => (i ? c : { ...c, enabled: 1 })) }).commands.status.tone, 'ok', 'one command on, no built-in');
  });

  test('no command and no built-in is grey', () => {
    assert.deepEqual(build({ streamer: { cmd_followage_enabled: 0 } }).commands.status, { key: 'cards.commands.status', params: { commands: 0, builtins: 0 }, tone: 'off' });
  });
});

describe('Sponsor messages', () => {
  const messages = (n, enabled = 1) => Array.from({ length: n }, (_, i) => ({ id: i + 1, message_text: `Partner ${i + 1}`, url: i ? null : 'https://example.test', enabled }));

  test('posting one every N minutes; three shown; the sponsor images link only with the overlay features', () => {
    const card = build({ sponsorMessages: messages(4) }).sponsors;
    assert.equal(card.needsChatbot, true);
    assert.deepEqual(card.status, { key: 'cards.sponsors.status.on', params: { minutes: 15, count: 4 }, tone: 'ok' });
    assert.deepEqual(card.messages.map((m) => [m.id, m.text, m.url, m.on, m.extra]), [
      [1, 'Partner 1', 'https://example.test', true, false], [2, 'Partner 2', '', true, false], [3, 'Partner 3', '', true, false], [4, 'Partner 4', '', true, true],
    ]);
    assert.deepEqual([card.on, card.minutes, card.intervals], [true, 15, [5, 10, 15, 20, 30, 60]]);
    assert.deepEqual(card.counts, { messages: { text: '4' } });
    assert.equal(card.imagesLink, true);
    assert.equal(build({ features: { overlays: false } }).sponsors.imagesLink, false);
  });

  test('off keeps the messages; on with none switched on is amber; an odd saved interval stays a choice', () => {
    assert.deepEqual(build({ streamer: { sponsor_send_chat: 0 }, sponsorMessages: messages(2) }).sponsors.status, { key: 'cards.sponsors.status.off', params: { count: 2 }, tone: 'off' });
    assert.equal(build({ sponsorMessages: messages(2, 0) }).sponsors.status.tone, 'warn');
    assert.deepEqual(build({ streamer: { sponsor_chat_interval_minutes: 7 } }).sponsors.intervals, [5, 7, 10, 15, 20, 30, 60]);
  });
});

describe('Donations', () => {
  test('a PayPal email first', () => {
    const card = build({ streamer: { paypal_email: null } }).donations;
    assert.deepEqual([card.setup, card.status], ['paypal', { key: 'cards.donations.status.setup', params: {}, tone: 'warn' }]);
  });

  test('the tip page on: its link, the goal and the latest tips, each with how long ago', () => {
    const card = build({
      tips: {
        count90d: 7,
        recent: [
          { id: 3, amount: 5, currency: 'EUR', donor_name: 'RacerFan', message: 'Great race', created_at: '2026-10-12 11:30:00' },
          { id: 2, amount: 10, currency: null, donor_name: null, message: null, created_at: '2026-10-14T11:58:00.000Z' },
        ],
      },
      tipGoal: { title: 'New wheel', current_amount: 101, target_amount: 1000, currency: 'EUR' },
    }).donations;
    assert.deepEqual(card.status, { key: 'cards.donations.status.on', params: { count: 7 }, tone: 'ok' });
    assert.deepEqual([card.setup, card.on, card.tipUrl, card.tipShown], [null, true, 'https://atleta.example/tip/synthetic_channel', 'atleta.example/tip/synthetic_channel']);
    assert.equal(card.showGoal, true);
    assert.deepEqual(card.goal, { title: 'New wheel', current: 101, target: 1000, currency: 'EUR', percent: 10 });
    assert.deepEqual(card.recent.map((d) => [d.id, d.amount, d.currency, d.name, d.message, d.ago]), [
      [3, 5, 'EUR', 'RacerFan', 'Great race', { key: 'nav.timeDays', params: { n: 2 } }],
      [2, 10, 'EUR', '', '', { key: 'nav.timeMinutes', params: { n: 2 } }],
    ]);
  });

  test('off; no goal; the goal section only with the overlay features; no tip link without Twitch', () => {
    assert.deepEqual(build({ streamer: { donation_page_enabled: 0 } }).donations.status, { key: 'cards.donations.status.off', params: {}, tone: 'off' });
    assert.deepEqual([build().donations.showGoal, build().donations.goal], [true, null]);
    assert.equal(build({ features: { overlays: false } }).donations.showGoal, false);
    const noTwitch = build({ streamer: { twitch_username: null } }).donations;
    assert.deepEqual([noTwitch.tipUrl, keyOf(noTwitch.status)], [null, 'cards.donations.status.noTwitch']);
  });

  test('reading tips aloud: the switch only while it is available, its line while it is on', () => {
    assert.equal(build().donations.tts, null, 'not available without the key');
    assert.deepEqual(build().donations.counts, {});
    const tts = { available: true, used: 2340, limit: 15000, lang: 'en' };
    const on = build({ tts, streamer: { tts_enabled: 1, tts_min_amount: 5, donation_currency: 'EUR' } }).donations;
    assert.deepEqual(on.tts, { on: true });
    assert.deepEqual(on.counts.tts, { key: 'cards.donations.ttsOn', params: { amount: '€5', used: '2,340', limit: '15,000' } });
    const cents = build({ tts: { ...tts, lang: 'pt' }, streamer: { tts_enabled: 1, tts_min_amount: 7.5, donation_currency: 'BRL' } }).donations;
    assert.deepEqual(cents.counts.tts.params, { amount: 'R$\u00a07,50', used: '2.340', limit: '15.000' });
    const off = build({ tts, streamer: { tts_enabled: 0 } }).donations;
    assert.deepEqual([off.tts, off.counts.tts], [{ on: false }, { text: '' }]);
    assert.equal(build({ tts, streamer: { paypal_email: null } }).donations.tts, null, 'not before the tip page has an email');
    const hidden = build({ tts, features: { overlays: false }, streamer: { tts_enabled: 1 } }).donations;
    assert.deepEqual([hidden.tts, hidden.counts], [null, {}], 'not while the overlay features are hidden');
  });
});

describe('Chat protection', () => {
  test('the filters that are on, the banned words counted, this week\'s moderation log', () => {
    const card = build({ bannedWords: { total: 3, regex: 1 }, modActionsThisWeek: 4 }).protection;
    assert.equal(card.needsChatbot, true);
    assert.deepEqual(card.status, { key: 'cards.protection.status.on', params: { on: 1, total: 6 }, tone: 'ok' });
    assert.deepEqual(card.filters.map((f) => [f.key, f.label, f.on]), [
      ['mod_link_protection_enabled', 'cards.protection.link', true],
      ['mod_banned_words_enabled', 'cards.protection.banned', false],
      ['mod_caps_enabled', 'cards.protection.caps', false],
      ['mod_emote_spam_enabled', 'cards.protection.emotes', false],
      ['mod_repetition_enabled', 'cards.protection.repetition', false],
      ['mod_symbol_spam_enabled', 'cards.protection.symbols', false],
    ]);
    assert.deepEqual([card.filters[1].hint, card.filters[1].hintParams], ['cards.protection.bannedHint', { count: 3 }]);
    assert.deepEqual(card.modLog, { key: 'cards.protection.modLog', params: { count: 4 } });
    assert.deepEqual(build({ streamer: { mod_link_protection_enabled: 0 } }).protection.status, { key: 'cards.protection.status.off', params: {}, tone: 'off' });
  });

  test('the moderator note only while Twitch says the bot is not a moderator there and the chatbot is on', () => {
    const note = (bot, streamer) => build({ bot: { connected: true, username: 'atleta_bot', ...bot }, streamer }).protection.moderatorNote;
    assert.equal(note({ moderator: false }), true);
    assert.equal(note({ moderator: true }), false);
    assert.equal(note({ moderator: null }), false, 'unknown: the bot is not in the channel');
    assert.equal(note({ moderator: false }, { chatbot_enabled: 0 }), false);
    assert.equal(note({ moderator: false, username: '' }), false, 'no bot name to give');
    assert.equal(build().protection.botName, 'atleta_bot');
  });
});

describe('Giveaways', () => {
  test('none running, or the running one with what its panel needs', () => {
    assert.deepEqual(build().giveaways, { needsChatbot: true, running: null, status: { key: 'cards.giveaways.status.none', params: {}, tone: 'off' } });
    const card = build({ giveaway: { id: 9, keyword: 'gw', prize: null, ends_at: '2026-10-14T12:05:00.000Z', winners_count: 2, subs_only: 1, entryCount: 4 } }).giveaways;
    assert.deepEqual(card.status, { key: 'cards.giveaways.status.running', params: {}, tone: 'warn' });
    assert.deepEqual(card.running, { id: 9, keyword: 'gw', prize: '', endsAt: '2026-10-14T12:05:00.000Z', winners: 2, subsOnly: true, entries: 4 });
  });
});

describe('Channel point rewards', () => {
  const rewards = [{ id: 1, title: 'Hydrate', cost: 500, enabled: 1 }, { id: 2, title: 'Horn', cost: 100, enabled: 0 }];

  test('the Twitch permission first, then Affiliate, then the switch and the rewards', () => {
    const states = [
      [{ rewardsAccess: { hasScope: false } }, 'permission', 'cards.rewards.status.permission', 'warn'],
      [{ streamer: { cp_affiliate_status: 'not_affiliate' } }, 'notAffiliate', 'cards.rewards.status.notAffiliate', 'warn'],
      [{ streamer: { cp_rewards_enabled: 0 }, rewards }, 'ok', 'cards.rewards.status.off', 'off'],
      [{}, 'ok', 'cards.rewards.status.empty', 'off'],
      [{ rewards }, 'ok', 'cards.rewards.status.on', 'ok'],
    ];
    for (const [over, access, key, tone] of states) {
      const card = build(over).rewards;
      assert.deepEqual([card.access, card.status.key, card.status.tone], [access, key, tone], JSON.stringify(over));
    }
    const card = build({ rewards }).rewards;
    assert.deepEqual(card.rewards, [{ id: 1, title: 'Hydrate', cost: 500, on: true }, { id: 2, title: 'Horn', cost: 100, on: false }]);
    assert.deepEqual(card.status.params, { count: 2 });
  });
});

describe('Spotify', () => {
  test('connected or not', () => {
    assert.deepEqual(build().spotify, { connected: true, status: { key: 'dashboard.status.connected', params: {}, tone: 'ok' } });
    assert.deepEqual(build({ spotifyConnected: false }).spotify, { connected: false, status: { key: 'dashboard.status.notConnected', params: {}, tone: 'off' } });
  });
});

describe('Polls & predictions', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  const tpl = (over = {}) => ({ id: 1, kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1, ...over });
  const view = (kind, over = {}) => ({ kind, id: `${kind}-1`, title: 'x', state: 'running', startedAt: NOW, endsAt: NOW + 60000, endedAt: null, result: null, options: [], total: 0, users: 0, ...over });
  const polls = (live, over = {}) => ({ polls: { hasScope: true, live: { poll: null, prediction: null, serverNow: NOW, ...live }, barUrl: 'https://atleta.example/overlay/poll/synthetic-token?lang=en', ...over } });

  test('its one setup step: link Twitch, reconnect for the two permissions, or Check again after Twitch said not an Affiliate', () => {
    const noTwitch = build({ streamer: { twitch_user_id: null } }).polls;
    assert.equal(noTwitch.setup, 'linkTwitch');
    assert.deepEqual(noTwitch.status, { key: 'cards.polls.status.noTwitch', params: {}, tone: 'warn' });
    const reconnect = build(polls({}, { hasScope: false })).polls;
    assert.equal(reconnect.setup, 'reconnect');
    assert.deepEqual(reconnect.status, { key: 'cards.polls.status.reconnect', params: {}, tone: 'warn' });
    const notAffiliate = build({ streamer: { cp_affiliate_status: 'not_affiliate' } }).polls;
    assert.equal(notAffiliate.setup, 'notAffiliate');
    assert.deepEqual(notAffiliate.status, { key: 'cards.polls.status.notAffiliate', params: {}, tone: 'warn' });
  });

  test('ready: the templates with their choices and time; the status counts them', () => {
    const card = build({ pollTemplates: [tpl(), tpl({ id: 2, kind: 'prediction', title: 'Clean lap?', choices: ['Clean', 'Chaos'], durationSeconds: 30 })] }).polls;
    assert.equal(card.setup, null);
    assert.deepEqual(card.status, { key: 'cards.polls.status.ready', params: { count: 2 }, tone: 'ok' });
    assert.deepEqual(card.templates.map((x) => [x.id, x.kind, x.title, x.choices, x.time]), [
      [1, 'poll', 'Top 5?', ['Yes', 'No'], { key: 'cards.common.minutes', params: { minutes: 2 } }],
      [2, 'prediction', 'Clean lap?', ['Clean', 'Chaos'], { key: 'cards.common.seconds', params: { seconds: 30 } }],
    ]);
    assert.deepEqual(card.blocked, { poll: false, prediction: false });
    assert.deepEqual(card.counts.templates, { text: '2' });
    assert.deepEqual(build({ pollTemplates: [tpl()] }).polls.status, { key: 'cards.polls.status.readyOne', params: {}, tone: 'ok' }, 'one template: "1 template"');
  });

  test('what runs on Twitch: the status, and the ▶ of a kind that runs (or waits for its winner) is off', () => {
    const status = (live) => build(polls(live)).polls.status.key;
    assert.equal(status({ poll: view('poll') }), 'cards.polls.status.pollRunning');
    assert.equal(status({ prediction: view('prediction') }), 'cards.polls.status.predictionRunning');
    assert.equal(status({ poll: view('poll'), prediction: view('prediction') }), 'cards.polls.status.bothRunning');
    assert.equal(status({ prediction: view('prediction', { state: 'locked' }) }), 'cards.polls.status.locked');
    assert.equal(status({ prediction: view('prediction', { state: 'ended', endedAt: NOW }) }), 'cards.polls.status.predictionEnded');
    assert.equal(status({ poll: view('poll', { state: 'ended', endedAt: NOW }) }), 'cards.polls.status.pollEnded');
    const card = build(polls({ prediction: view('prediction', { state: 'locked' }) })).polls;
    assert.deepEqual(card.blocked, { poll: false, prediction: true });
    assert.equal(card.status.tone, 'warn');
    assert.equal(card.live.prediction.state, 'locked', 'the live panel starts from it');
  });

  test('a poll running beside a prediction that waits for its winner: the line asks for the winner, and both ▶ are off', () => {
    const card = build(polls({ poll: view('poll'), prediction: view('prediction', { state: 'locked' }) })).polls;
    assert.deepEqual(card.status, { key: 'cards.polls.status.locked', params: {}, tone: 'warn' });
    assert.deepEqual(card.blocked, { poll: true, prediction: true });
  });

  test('one rule for the status line (the live answers use it too): the setup step while there is one, whatever runs', () => {
    const linked = { twitch_user_id: '1001', twitch_username: 'synthetic_channel' };
    assert.deepEqual([
      pollsSetup({ twitch_user_id: null }, true), pollsSetup(linked, false),
      pollsSetup({ ...linked, cp_affiliate_status: 'not_affiliate' }, true), pollsSetup(linked, true),
    ], ['linkTwitch', 'reconnect', 'notAffiliate', null]);
    const running = { poll: view('poll'), prediction: null, serverNow: NOW };
    assert.deepEqual(pollsStatus(running, 2, 'notAffiliate'), { key: 'cards.polls.status.notAffiliate', params: {}, tone: 'warn' });
    assert.deepEqual(pollsStatus(running, 2, null), { key: 'cards.polls.status.pollRunning', params: {}, tone: 'ok' });
    assert.deepEqual(pollsStatus(running, 2), { key: 'cards.polls.status.pollRunning', params: {}, tone: 'ok' }, 'no setup step given');
  });

  test('the announcements: the switch, the six texts with their variables, and a note while the chatbot is off', () => {
    const card = build().polls;
    assert.equal(card.announce, true);
    assert.equal(card.chatNote, false);
    assert.deepEqual(card.texts.map((x) => [x.key, x.text]), [
      ['poll_start_template', 'Poll: {title}'], ['poll_end_template', 'Closed: {winner}'], ['prediction_start_template', 'Prediction: {title}'],
      ['prediction_lock_template', 'Locked: {title}'], ['prediction_end_template', '{outcome} wins'], ['prediction_cancel_template', ''],
    ]);
    assert.deepEqual(card.texts[1].vars, ['{title}', '{winner}', '{percent}', '{votes}']);
    assert.equal(build({ streamer: { chatbot_enabled: 0 } }).polls.chatNote, true);
    assert.equal(build({ streamer: { chatbot_enabled: 0, polls_chat_enabled: 0 } }).polls.chatNote, false);
  });

  test('the pop-up gets Twitch\'s limits; the bar\'s OBS link is masked, and only there with the overlay features', () => {
    const card = build().polls;
    assert.deepEqual(card.limits.poll, { titleMax: 60, choiceMax: 25, minChoices: 2, maxChoices: 5, minSeconds: 15, maxSeconds: 1800 });
    assert.deepEqual(card.limits.prediction, { titleMax: 45, choiceMax: 25, minChoices: 2, maxChoices: 10, minSeconds: 30, maxSeconds: 1800 });
    assert.deepEqual(card.limits.durations.prediction, [60, 120, 300, 600, 1800]);
    assert.equal(card.limits.templatesMax, 20);
    assert.deepEqual(card.bar, {
      url: 'https://atleta.example/overlay/poll/synthetic-token?lang=en',
      shown: 'atleta.example/overlay/poll/synthetic-token?lang=en',
      masked: `atleta.example/overlay/poll/${'•'.repeat(12)}`,
    });
    assert.equal(build({ features: { overlays: false } }).polls.bar, null);
    assert.equal(build(polls({}, { barUrl: null })).polls.bar, null);
  });
});

describe('Shoutouts', () => {
  test('the status names what is on; the card needs the chatbot', () => {
    const status = (over) => build({ streamer: over }).shoutouts.status;
    assert.deepEqual(status({}), { key: 'cards.shoutouts.status.both', params: { viewers: 5 }, tone: 'ok' });
    assert.deepEqual(status({ shoutout_raid_enabled: 0 }), { key: 'cards.shoutouts.status.command', params: {}, tone: 'ok' });
    assert.deepEqual(status({ shoutout_command_enabled: 0 }), { key: 'cards.shoutouts.status.raid', params: { viewers: 5 }, tone: 'ok' });
    assert.deepEqual(status({ shoutout_command_enabled: 0, shoutout_raid_enabled: 0 }), { key: 'cards.shoutouts.status.off', params: {}, tone: 'off' });
    assert.equal(build().shoutouts.needsChatbot, true);
  });

  test('the raid minimum offers the card\'s choices (a value saved elsewhere among them); the message, its variables and an example', () => {
    const card = build().shoutouts;
    assert.deepEqual(card.viewerChoices, [1, 2, 5, 10, 25, 50, 100]);
    assert.deepEqual(build({ streamer: { shoutout_raid_min_viewers: 3 } }).shoutouts.viewerChoices, [1, 2, 3, 5, 10, 25, 50, 100]);
    assert.deepEqual(card.vars, ['{name}', '{game}', '{title}', '{link}']);
    assert.equal(card.text, 'Go check out {name}! They were last streaming {game}: {link}');
    assert.equal(card.example, 'Go check out RivalRacer! They were last streaming iRacing: https://twitch.tv/rivalracer');
  });
});

describe('cardTexts', () => {
  test('translates each status and count, gives plain counts as they are, and leaves the giveaway card to the page', () => {
    const t = (key, params) => `${key}${params && Object.keys(params).length ? JSON.stringify(params) : ''}`;
    const texts = cardTexts(build({ commands: [{ id: 1, command: 'discord', response: 'x', cooldown: 5 }] }), t);
    assert.deepEqual(Object.keys(texts), ['chatbot', 'discord', 'overlay', 'tracking', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'polls', 'rewards', 'spotify']);
    assert.deepEqual(texts.chatbot, { status: { text: 'cards.chatbot.status.online{"channel":"synthetic_channel"}', tone: 'ok' }, counts: { thankYous: 'cards.common.nOfM{"on":5,"total":6}' } });
    assert.deepEqual(texts.commands.counts, { commands: '1', builtins: 'cards.common.nOfM{"on":1,"total":13}' });
    assert.deepEqual(texts.spotify, { status: { text: 'dashboard.status.connected', tone: 'ok' }, counts: {} });
  });
});

describe('Tracking', () => {
  const goal = { id: 4, kind: 'sub', title: 'Road to 50', current: 17, target: 50, percent: 34, completed: false, barColor: '#a56bff', period: 'month', mode: 'calendar', unavailable: null };

  test('every tracker with its switch, link and last value; the goals with their links; the status counts both', () => {
    const tr = trackingInput();
    tr.trackers.latest_bits.enabled = false;
    tr.trackers.latest_sub.value = { name: 'Loyal', months: 14, tier: '2' };
    tr.trackers.latest_raid.value = { name: 'Raider', viewers: 1 };
    tr.trackers.latest_bits.value = { name: 'Cheerer', amount: 500 };
    tr.trackers.top_tipper.value = { name: 'Marta', amount: 25, currency: 'EUR' };
    tr.goals.sub = { goal, timeZone: 'Europe/Lisbon', hours: null, history: [] };
    const card = build({ tracking: tr }).tracking;
    assert.deepEqual(card.status, { key: 'cards.tracking.status.summary', params: { goals: 1, trackers: 5, total: 6 }, tone: 'ok' });
    assert.deepEqual(card.counts.trackers, { key: 'cards.common.nOfM', params: { on: 5, total: 6 } });
    assert.deepEqual(card.trackers.map((r) => [r.id, r.label, r.on]), [
      ['latest_follower', 'tracking.source.latestFollower', true], ['latest_sub', 'tracking.source.latestSub', true],
      ['latest_tip', 'tracking.source.latestTip', true], ['latest_raid', 'tracking.source.latestRaid', true],
      ['latest_bits', 'tracking.source.latestBits', false], ['top_tipper', 'tracking.source.topTipper', true],
    ]);
    assert.equal(card.trackers[0].url, 'https://atleta.example/overlay/tracker/latest_follower/tok?lang=en');
    assert.equal(card.trackers[0].line, null, 'nothing yet');
    assert.deepEqual(card.trackers[1].line, { name: 'Loyal', detail: { key: 'tracking.source.months', params: { count: 14 } }, money: null });
    assert.deepEqual(card.trackers[3].line.detail, { key: 'tracking.source.viewerOne', params: {} }, 'one viewer');
    assert.deepEqual(card.trackers[4].line.detail, { key: 'tracking.source.bits', params: { count: 500 } });
    assert.deepEqual(card.trackers[5].line, { name: 'Marta', detail: null, money: { amount: 25, currency: 'EUR' } });
    assert.equal(card.goals.follow.goal, null);
    assert.equal(card.goals.follow.url, 'https://atleta.example/overlay/goal/followers/tok?lang=en');
    assert.deepEqual(card.goals.sub, { goal, hours: null, timeZone: 'Europe/Lisbon', url: 'https://atleta.example/overlay/goal/subs/tok?lang=en' });
  });

  test('a gift on the latest sub; Latest sub not available for a channel that is not an Affiliate', () => {
    const tr = trackingInput({ notAffiliate: true });
    tr.trackers.latest_sub.value = { name: 'Gifter', gifted: 5 };
    const card = build({ tracking: tr }).tracking;
    assert.deepEqual(card.trackers[1].line.detail, { key: 'tracking.source.gifted', params: { count: 5 } });
    assert.equal(card.trackers[1].unavailable, true);
    assert.equal(card.trackers[0].unavailable, false);
  });

  test('without an OBS link: the status says so and nothing has a link; everything off is grey', () => {
    const noLink = build({ tracking: trackingInput({ links: null }) }).tracking;
    assert.deepEqual(noLink.status, { key: 'cards.tracking.status.noLink', params: {}, tone: 'warn' });
    assert.equal(noLink.hasLink, false);
    assert.ok(noLink.trackers.every((r) => r.url === null));
    assert.equal(noLink.goals.sub.url, null);
    const tr = trackingInput();
    for (const row of Object.values(tr.trackers)) row.enabled = false;
    assert.equal(build({ tracking: tr }).tracking.status.tone, 'off');
  });
});
