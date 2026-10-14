'use strict';

// What each of the dashboard's working cards shows (views/cards/*.ejs), decided from the data GET /dashboard
// gathers (gatherCards() in routes/dashboard.js). Pure: nothing here reads the database or asks Discord or
// Twitch, so every state is tested on its own (dashboardCards.test.js). A status is a text key with its params and
// a tone ('ok' green, 'off' grey, 'warn' amber: something is missing); a count is a text key with its params, or a
// plain { text }. The view translates them, and so does GET /dashboard/api/cards after a change (cardTexts()).

const { DURATIONS } = require('./overlaySettings');
const { sponsorChatIntervalMinutes } = require('./inputLimits');

// The cards in reading order, which is also their order on a phone. The OBS overlay and rewards cards are left out
// while the overlay features are off; the Multistream card comes last while the relay is set up.
const ORDER = ['chatbot', 'discord', 'overlay', 'commands', 'sponsors', 'donations', 'protection', 'giveaways', 'rewards', 'spotify'];
const OVERLAY_CARDS = new Set(['overlay', 'rewards']);

const label = (key, params = {}) => ({ key, params });
const missing = (key, params = {}) => ({ key, params, warn: true });
const status = (key, tone = 'ok', params = {}) => ({ key, params, tone });
const nOfM = (on, total) => label('cards.common.nOfM', { on, total });
const plain = (n) => ({ text: String(n) });
const twitchLinked = (streamer) => !!(streamer.twitch_user_id && streamer.twitch_username);

// The thank-you messages: their row label and the variables each message may use (the chatbot page's list).
const THANK_YOUS = [
  { event: 'follow', label: 'cards.events.follow', vars: ['{username}'] },
  { event: 'sub', label: 'cards.events.sub', vars: ['{username}', '{tier}', '{months}', '{message}'] },
  { event: 'giftsub', label: 'cards.events.giftsub', vars: ['{username}', '{amount}', '{tier}'] },
  { event: 'bits', label: 'cards.events.bits', vars: ['{username}', '{amount}', '{message}'] },
  { event: 'donation', label: 'cards.events.donation', vars: ['{username}', '{amount}', '{currency}', '{message}'] },
  { event: 'raid', label: 'cards.events.raid', vars: ['{username}', '{viewers}'] },
];

// The OBS overlay's alerts: their streamers columns (overlay_<column>_enabled, overlay_<column>_duration) and
// the type their test button sends (OVERLAY_TEST_EVENTS in routes/dashboard.js).
const ALERTS = [
  { column: 'follow', label: 'cards.events.follow', test: 'follow' },
  { column: 'sub', label: 'cards.events.sub', test: 'subscription' },
  { column: 'bits', label: 'cards.events.bits', test: 'bits' },
  { column: 'donation', label: 'cards.events.donation', test: 'donation' },
  { column: 'raid', label: 'cards.events.raid', test: 'raid' },
  { column: 'giveaway', label: 'cards.events.giveaway', test: 'giveaway_winner' },
];
const SECONDS = [5, 8, 10, 12, 15, 20, 30];
const LONG_SECONDS = [...SECONDS, 45, 60]; // the giveaway winner may stay up to 60 s
const DURATION = Object.fromEntries(DURATIONS.map(([column, fallback, longest]) => [column, { fallback, longest }]));

const BUILTINS = ['followage', 'subage', 'uptime', 'accountage', '8ball', 'roll', 'hug', 'slap', 'love', 'rps', 'coinflip', 'quote', 'roast'];

const FILTERS = [
  { column: 'mod_link_protection_enabled', label: 'cards.protection.link', hint: 'cards.protection.linkHint' },
  { column: 'mod_banned_words_enabled', label: 'cards.protection.banned', hint: 'cards.protection.bannedHint' },
  { column: 'mod_caps_enabled', label: 'cards.protection.caps', hint: 'cards.protection.capsHint' },
  { column: 'mod_emote_spam_enabled', label: 'cards.protection.emotes', hint: 'cards.protection.emotesHint' },
  { column: 'mod_repetition_enabled', label: 'cards.protection.repetition', hint: 'cards.protection.repetitionHint' },
  { column: 'mod_symbol_spam_enabled', label: 'cards.protection.symbols', hint: 'cards.protection.symbolsHint' },
];

const SPONSOR_INTERVALS = [5, 10, 15, 20, 30, 60];
const COMMANDS_SHOWN = 4; // the rest are behind "Show all"
const SPONSORS_SHOWN = 3;

// The usual choices of a select, with the value saved now among them (an older page may have saved another).
function choices(usual, current) {
  return [...new Set([...usual, current])].filter(Number.isFinite).sort((a, b) => a - b);
}

// "x ago" for a time the database stored in UTC ('YYYY-MM-DD HH:MM:SS', or ISO with its zone).
function ago(stored, now) {
  const value = String(stored || '');
  const ms = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.floor((now - ms) / 60000));
  if (minutes < 1) return label('nav.timeNow');
  if (minutes < 60) return label('nav.timeMinutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return label('nav.timeHours', { n: hours });
  return label('nav.timeDays', { n: Math.floor(hours / 24) });
}

function chatbotCard({ streamer, bot }) {
  const on = !!streamer.chatbot_enabled;
  const thankYous = THANK_YOUS.map((ty) => ({
    event: ty.event,
    label: ty.label,
    vars: ty.vars,
    switchKey: `chat_${ty.event}_enabled`,
    textKey: `chat_${ty.event}_template`,
    on: !!streamer[`chat_${ty.event}_enabled`],
    text: streamer[`chat_${ty.event}_template`] || '',
  }));
  let st;
  if (!twitchLinked(streamer)) st = status('cards.chatbot.status.noTwitch', 'warn');
  else if (!on) st = status('cards.chatbot.status.off', 'off');
  else if (!bot.connected) st = status('cards.chatbot.status.connecting', 'warn');
  else st = status('cards.chatbot.status.online', 'ok', { channel: streamer.twitch_username });
  return {
    setup: twitchLinked(streamer) ? null : 'linkTwitch',
    on,
    status: st,
    thankYous,
    counts: { thankYous: nOfM(thankYous.filter((ty) => ty.on).length, thankYous.length) },
  };
}

// One server's six switches: what each stores (the watcher row of the streamer's own channel for go-live and
// clips, the server's row for the rest), the line under it (where the posts go, or what is missing, marked warn)
// and the tab of the server page that sets what is missing.
function serverSwitches(s) {
  const where = (name, set) => (name ? label('cards.discord.inChannel', { channel: name })
    : set ? label('cards.discord.channelUnknown') : missing('cards.discord.pickChannel'));
  const intoLiveChannel = (on, hint) => (on && !s.hasLiveChannel ? missing('cards.discord.needsLiveChannel') : label(hint));
  return [
    { key: 'notify_live', label: 'dashboard.cards.discord.goLive', on: s.switches.goLive, fix: 'twitch', hint: where(s.liveWhere, s.hasLiveChannel) },
    { key: 'notify_clips', label: 'dashboard.cards.discord.clips', on: s.switches.clips, fix: 'twitch', hint: where(s.clipsWhere, s.hasClipsChannel) },
    { key: 'recap_enabled', label: 'dashboard.cards.discord.recaps', on: s.switches.recaps, fix: 'twitch', hint: intoLiveChannel(s.switches.recaps, 'cards.discord.recapsHint') },
    {
      key: 'milestones_enabled', label: 'dashboard.cards.discord.milestones', on: s.switches.milestones, fix: 'twitch',
      hint: s.milestones === 'wait' ? missing('dashboard.cards.discord.wait') : intoLiveChannel(s.switches.milestones, 'cards.discord.milestonesHint'),
    },
    {
      key: 'weekly_highlights_enabled', label: 'dashboard.cards.discord.highlights', on: s.switches.highlights, fix: 'twitch',
      hint: s.switches.highlights && s.highlights !== 'on' ? missing('cards.discord.notPosted') : label('cards.discord.highlightsHint'),
    },
    {
      key: 'sub_sync_enabled', label: 'dashboard.cards.discord.subRoles', on: s.switches.subRoles, fix: 'discord',
      hint: s.subRoles === 'wait' ? missing('dashboard.cards.discord.wait')
        : !s.hasSubRole ? missing('cards.discord.pickRole') : label('cards.discord.subRolesHint'),
    },
  ];
}

function discordCard({ discord: d }) {
  if (!d.twitchLinked) return { setup: 'linkTwitch', status: status('dashboard.cards.discord.statusNoTwitch', 'warn'), servers: [] };
  if (d.servers.length === 0) return { setup: 'addServer', status: status('dashboard.cards.discord.statusNoServer', 'warn'), servers: [] };
  const total = d.servers.length;
  let st;
  if (d.announcing === total) st = status('dashboard.cards.discord.statusAll');
  else if (d.announcing > 0) st = status('dashboard.cards.discord.statusSome', 'ok', { count: d.announcing, total });
  else st = status('dashboard.cards.discord.statusNone', 'warn');
  return {
    setup: null,
    status: st,
    needsAuth: !!d.needsAuth,
    authAction: d.authAction,
    servers: d.servers.map((s) => ({ guildId: s.guildId, name: s.name, botPresent: s.botPresent, url: s.url, switches: serverSwitches(s) })),
  };
}

function overlayCard({ streamer, overlay }) {
  const on = !!streamer.overlay_enabled;
  const alerts = ALERTS.map((a) => {
    const durationKey = `overlay_${a.column}_duration`;
    const { fallback, longest } = DURATION[durationKey];
    const stored = Number(streamer[durationKey]);
    const seconds = Number.isInteger(stored) && stored >= 1 && stored <= longest ? stored : fallback;
    return {
      label: a.label,
      test: a.test,
      switchKey: `overlay_${a.column}_enabled`,
      durationKey,
      on: !!streamer[`overlay_${a.column}_enabled`],
      seconds,
      choices: choices(longest > 30 ? LONG_SECONDS : SECONDS, seconds),
    };
  });
  const rawVolume = streamer.overlay_volume;
  const volume = rawVolume === null || rawVolume === undefined || rawVolume === '' ? 0.8 : Number(rawVolume);
  let st;
  if (!on) st = status('cards.overlay.status.off', 'off');
  else if (overlay.open) st = status('cards.overlay.status.open');
  else st = status('cards.overlay.status.notOpen', 'warn');
  const shown = overlay.url ? overlay.url.replace(/^https?:\/\//, '') : null;
  return {
    on,
    status: st,
    open: !!overlay.open,
    url: overlay.url || null,
    shown,
    masked: shown ? shown.replace(/\/overlay\/.*$/, `/overlay/${'•'.repeat(12)}`) : null,
    alerts,
    volume: Math.round((Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8) * 100),
    counts: { alerts: nOfM(alerts.filter((a) => a.on).length, alerts.length) },
  };
}

function commandsCard({ streamer, commands }) {
  const builtins = BUILTINS.map((name) => ({ key: `cmd_${name}_enabled`, name: `!${name}`, on: !!streamer[`cmd_${name}_enabled`] }));
  const builtinsOn = builtins.filter((b) => b.on).length;
  // A command switched off on the chatbot page (chat_commands.enabled = 0) stays in the list and in the counts; its
  // row says `on: false`, so the card can show it dimmed: the bot ignores it.
  const rows = commands.map((c, i) => ({ id: c.id, name: c.command, response: c.response, cooldown: c.cooldown, on: !!c.enabled, extra: i >= COMMANDS_SHOWN }));
  return {
    needsChatbot: true,
    status: status('cards.commands.status', rows.length + builtinsOn > 0 ? 'ok' : 'off', { commands: rows.length, builtins: builtinsOn }),
    commands: rows,
    builtins,
    counts: { commands: plain(rows.length), builtins: nOfM(builtinsOn, builtins.length) },
  };
}

function sponsorsCard({ streamer, sponsorMessages, features }) {
  const on = !!streamer.sponsor_send_chat;
  const minutes = sponsorChatIntervalMinutes(streamer.sponsor_chat_interval_minutes);
  const messages = sponsorMessages.map((m, i) => ({ id: m.id, text: m.message_text, url: m.url || '', on: !!m.enabled, extra: i >= SPONSORS_SHOWN }));
  const count = messages.length;
  return {
    needsChatbot: true,
    on,
    minutes,
    intervals: choices(SPONSOR_INTERVALS, minutes),
    messages,
    imagesLink: !!features.overlays,
    status: on ? status('cards.sponsors.status.on', messages.some((m) => m.on) ? 'ok' : 'warn', { minutes, count })
      : status('cards.sponsors.status.off', 'off', { count }),
    counts: { messages: plain(count) },
  };
}

function donationsCard({ streamer, tips, tipGoal, features, appUrl, now }) {
  const hasEmail = !!streamer.paypal_email;
  const on = !!streamer.donation_page_enabled;
  const tipUrl = streamer.twitch_username ? `${appUrl}/tip/${encodeURIComponent(streamer.twitch_username)}` : null;
  let st;
  if (!hasEmail) st = status('cards.donations.status.setup', 'warn');
  else if (!on) st = status('cards.donations.status.off', 'off');
  else if (!tipUrl) st = status('cards.donations.status.noTwitch', 'warn');
  else st = status('cards.donations.status.on', 'ok', { count: tips.count90d });
  const currency = streamer.donation_currency || 'EUR';
  let goal = null;
  if (tipGoal) {
    const current = Number(tipGoal.current_amount) || 0;
    const target = Number(tipGoal.target_amount) || 0;
    goal = { title: tipGoal.title, current, target, currency: tipGoal.currency || 'EUR', percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0 };
  }
  return {
    setup: hasEmail ? null : 'paypal',
    on,
    status: st,
    tipUrl,
    tipShown: tipUrl ? tipUrl.replace(/^https?:\/\//, '') : null,
    currency,
    showGoal: !!features.overlays,
    goal,
    recent: tips.recent.map((d) => ({
      id: d.id, amount: Number(d.amount) || 0, currency: d.currency || currency, name: d.donor_name || '', message: d.message || '', ago: ago(d.created_at, now),
    })),
    counts: {},
  };
}

function protectionCard({ streamer, bot, bannedWords, modActionsThisWeek }) {
  const filters = FILTERS.map((f) => ({
    key: f.column,
    label: f.label,
    hint: f.hint,
    hintParams: f.column === 'mod_banned_words_enabled' ? { count: bannedWords.total } : {},
    on: !!streamer[f.column],
  }));
  const on = filters.filter((f) => f.on).length;
  return {
    needsChatbot: true,
    status: on ? status('cards.protection.status.on', 'ok', { on, total: filters.length }) : status('cards.protection.status.off', 'off'),
    filters,
    // Twitch told the bot, in the streamer's channel, that it is not a moderator there (moderatorStatus()).
    moderatorNote: !!streamer.chatbot_enabled && bot.moderator === false && !!bot.username,
    botName: bot.username || '',
    modLog: label('cards.protection.modLog', { count: modActionsThisWeek }),
    counts: {},
  };
}

function giveawaysCard({ giveaway }) {
  if (!giveaway) return { needsChatbot: true, running: null, status: status('cards.giveaways.status.none', 'off') };
  return {
    needsChatbot: true,
    status: status('cards.giveaways.status.running', 'warn'),
    running: {
      id: giveaway.id,
      keyword: giveaway.keyword,
      prize: giveaway.prize || '',
      endsAt: giveaway.ends_at || '',
      winners: giveaway.winners_count || 1,
      subsOnly: !!giveaway.subs_only,
      entries: giveaway.entryCount || 0,
    },
  };
}

function rewardsCard({ streamer, rewards, rewardsAccess }) {
  const on = !!streamer.cp_rewards_enabled;
  let access = 'ok';
  if (!rewardsAccess.hasScope) access = 'permission';
  else if (streamer.cp_affiliate_status === 'not_affiliate') access = 'notAffiliate';
  const rows = rewards.map((r) => ({ id: r.id, title: r.title, cost: r.cost, on: !!r.enabled }));
  let st;
  if (access === 'permission') st = status('cards.rewards.status.permission', 'warn');
  else if (access === 'notAffiliate') st = status('cards.rewards.status.notAffiliate', 'warn');
  else if (!on) st = status('cards.rewards.status.off', 'off');
  else if (rows.length === 0) st = status('cards.rewards.status.empty', 'off');
  else st = status('cards.rewards.status.on', 'ok', { count: rows.length });
  return { on, access, rewards: rows, status: st, counts: {} };
}

function spotifyCard({ spotifyConnected }) {
  return {
    connected: !!spotifyConnected,
    status: spotifyConnected ? status('dashboard.status.connected') : status('dashboard.status.notConnected', 'off'),
  };
}

function multistreamCard({ streamer }) {
  const on = !!streamer.multistream_enabled;
  return { on, status: on ? status('dashboard.cards.multistream.active') : status('dashboard.cards.multistream.sub', 'off') };
}

const BUILDERS = {
  chatbot: chatbotCard, discord: discordCard, overlay: overlayCard, commands: commandsCard, sponsors: sponsorsCard,
  donations: donationsCard, protection: protectionCard, giveaways: giveawaysCard, rewards: rewardsCard, spotify: spotifyCard,
  multistream: multistreamCard,
};

function buildCards(input) {
  const features = input.features || {};
  const order = ORDER.filter((name) => features.overlays || !OVERLAY_CARDS.has(name));
  if (input.multistreamAvailable) order.push('multistream');
  const cards = { order, chatbotOn: !!input.streamer.chatbot_enabled };
  for (const name of order) cards[name] = BUILDERS[name]({ ...input, features });
  return cards;
}

// Each card's status line and counts, translated with t(key, params): what GET /dashboard/api/cards answers after
// a change. The giveaway card is left out: the page keeps its panel's own state (a winner just picked) until the
// streamer closes it.
function cardTexts(cards, t) {
  const out = {};
  for (const name of cards.order) {
    if (name === 'giveaways') continue;
    const card = cards[name];
    out[name] = {
      status: { text: t(card.status.key, card.status.params), tone: card.status.tone },
      counts: Object.fromEntries(Object.entries(card.counts || {}).map(([key, c]) => [key, c.text !== undefined ? c.text : t(c.key, c.params)])),
    };
  }
  return out;
}

module.exports = { buildCards, cardTexts, ORDER };
