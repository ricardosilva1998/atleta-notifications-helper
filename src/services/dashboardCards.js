'use strict';

// What each of the dashboard's working cards shows (views/cards/*.ejs), decided from the data GET /dashboard
// gathers (gatherCards() in routes/dashboard.js). Pure: nothing here reads the database or asks Discord or
// Twitch, so every state is tested on its own (dashboardCards.test.js). A status is a text key with its params and
// a tone ('ok' green, 'off' grey, 'warn' amber: something is missing); a count is a text key with its params, or a
// plain { text }. The view translates them, and so does GET /dashboard/api/cards after a change (cardTexts()).

const { DURATIONS, wholeSeconds, volumeOf } = require('./overlaySettings');
const { sponsorChatIntervalMinutes } = require('./inputLimits');
const { CHAT_TEXTS: POLL_TEXTS, LIMITS: POLL_LIMITS, POINTS_PER_VOTE, DURATION_CHOICES, TEMPLATES_MAX } = require('./pollRules');
const { RAID_MIN_VIEWERS, shoutoutLine } = require('./shoutouts');

// The cards in reading order, which is also their order on a phone. The OBS overlay and rewards cards are left out
// while the overlay features are off; the Multistream card comes last while the relay is set up.
const ORDER = ['chatbot', 'discord', 'overlay', 'tracking', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'rewards', 'spotify'];
const OVERLAY_CARDS = new Set(['overlay', 'tracking', 'rewards']);

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
// icon and short: the OBS overlay card's test button for the alert (an id in views/cards/_icons.ejs; its colour is the
// .wc-test.<column> rule in _style.ejs).
const ALERTS = [
  { column: 'follow', label: 'cards.events.follow', test: 'follow', icon: 'i-heart', short: 'cards.overlay.testName.follow' },
  { column: 'sub', label: 'cards.events.sub', test: 'subscription', icon: 'i-star', short: 'cards.overlay.testName.sub' },
  { column: 'bits', label: 'cards.events.bits', test: 'bits', icon: 'i-gem', short: 'cards.overlay.testName.bits' },
  { column: 'donation', label: 'cards.events.donation', test: 'donation', icon: 'i-coin', short: 'cards.overlay.testName.donation' },
  { column: 'raid', label: 'cards.events.raid', test: 'raid', icon: 'i-users', short: 'cards.overlay.testName.raid' },
  { column: 'giveaway', label: 'cards.events.giveaway', test: 'giveaway_winner', icon: 'i-gift', short: 'cards.overlay.testName.giveaway' },
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

// The poll bar's OBS link as the cards show it: without its scheme, and masked until Show (its token is a secret).
function pollBarLink(url) {
  if (!url) return null;
  const shown = url.replace(/^https?:\/\//, '');
  return { url, shown, masked: shown.replace(/\/overlay\/poll\/.*$/, `/overlay/poll/${'•'.repeat(12)}`) };
}

// A template's time as the card writes it: whole minutes, else seconds.
const timeLabel = (seconds) => (seconds >= 60 && seconds % 60 === 0
  ? label('cards.common.minutes', { minutes: seconds / 60 })
  : label('cards.common.seconds', { seconds }));

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

// The seconds and the volume are what the overlay is told: buildOverlayConfig() reads the same stored values through
// the same two functions, so the card never shows a number the overlay does not play.
function overlayCard({ streamer, overlay, polls }) {
  const on = !!streamer.overlay_enabled;
  const alerts = ALERTS.map((a) => {
    const durationKey = `overlay_${a.column}_duration`;
    const { fallback, longest } = DURATION[durationKey];
    const seconds = wholeSeconds(streamer[durationKey], fallback, longest);
    return {
      label: a.label,
      test: a.test,
      icon: a.icon,
      short: a.short,
      tone: a.column,
      switchKey: `overlay_${a.column}_enabled`,
      durationKey,
      on: !!streamer[`overlay_${a.column}_enabled`],
      seconds,
      choices: choices(longest > 30 ? LONG_SECONDS : SECONDS, seconds),
    };
  });
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
    pollBar: pollBarLink(polls && polls.barUrl),
    alerts,
    volume: Math.round(volumeOf(streamer.overlay_volume) * 100),
    counts: { alerts: nOfM(alerts.filter((a) => a.on).length, alerts.length) },
  };
}

// The Tracking card: the follower and sub goal bars and the six trackers (services/trackingGoals.js, trackers.js),
// each with its OBS link. `tracking` is what the Tracking page's state route answers (trackingState() in
// routes/dashboard.js) plus the links (null without an overlay token). The goals are drawn by the page script from
// `goals` (public/js/dashboard-tracking.js); a tracker's line is its last value: the name, and a detail as a text key
// with its count, or an amount with its currency (the view formats it in the page's language).
const TRACKER_LABELS = {
  latest_follower: 'tracking.source.latestFollower', latest_sub: 'tracking.source.latestSub', latest_tip: 'tracking.source.latestTip',
  latest_raid: 'tracking.source.latestRaid', latest_bits: 'tracking.source.latestBits', top_tipper: 'tracking.source.topTipper',
};
const counted = (key, oneKey, n) => (Number(n) === 1 && oneKey ? label(oneKey) : label(key, { count: Number(n) || 0 }));
function trackerLine(tracker, value) {
  if (!value || !value.name) return null;
  const line = { name: String(value.name), detail: null, money: null };
  if (tracker === 'latest_sub') {
    if (Number(value.gifted) > 0) line.detail = counted('tracking.source.gifted', null, value.gifted);
    else if (Number(value.months) > 0) line.detail = counted('tracking.source.months', 'tracking.source.monthOne', value.months);
  } else if (tracker === 'latest_raid') line.detail = counted('tracking.source.viewers', 'tracking.source.viewerOne', value.viewers);
  else if (tracker === 'latest_bits') line.detail = counted('tracking.source.bits', 'tracking.source.bitOne', value.amount);
  else if (tracker === 'latest_tip' || tracker === 'top_tipper') line.money = { amount: Number(value.amount) || 0, currency: value.currency || null };
  return line;
}
function trackingCard({ tracking }) {
  const t = tracking || {};
  const links = t.links || null;
  const goals = {};
  for (const kind of ['follow', 'sub']) {
    const entry = (t.goals && t.goals[kind]) || {};
    goals[kind] = { goal: entry.goal || null, hours: entry.hours || null, timeZone: entry.timeZone || null, url: links ? links.goals[kind] : null };
  }
  const trackers = Object.keys(TRACKER_LABELS).map((id) => {
    const row = (t.trackers && t.trackers[id]) || {};
    return {
      id,
      label: TRACKER_LABELS[id],
      on: row.enabled !== false,
      url: links ? links.trackers[id] : null,
      unavailable: id === 'latest_sub' && !!t.notAffiliate,
      line: trackerLine(id, row.value),
    };
  });
  const running = Object.values(goals).filter((g) => g.goal).length;
  const on = trackers.filter((r) => r.on).length;
  let st;
  if (!links) st = status('cards.tracking.status.noLink', 'warn');
  else st = status('cards.tracking.status.summary', running || on ? 'ok' : 'off', { goals: running, trackers: on, total: trackers.length });
  return {
    status: st,
    hasLink: !!links,
    notAffiliate: !!t.notAffiliate,
    goals,
    trackers,
    counts: { trackers: nOfM(on, trackers.length) },
  };
}

function commandsCard({ streamer, commands }) {
  const builtins = BUILTINS.map((name) => ({ key: `cmd_${name}_enabled`, name: `!${name}`, on: !!streamer[`cmd_${name}_enabled`] }));
  const builtinsOn = builtins.filter((b) => b.on).length;
  // A command switched off on the chatbot page (chat_commands.enabled = 0) stays in the list and in the counts; its
  // row says `on: false`, so the card can show it dimmed: the bot ignores it. The status is green only while something
  // answers in chat, a command that is on or a built-in that is on.
  const rows = commands.map((c, i) => ({ id: c.id, name: c.command, response: c.response, cooldown: c.cooldown, on: !!c.enabled, extra: i >= COMMANDS_SHOWN }));
  const answering = rows.some((r) => r.on) || builtinsOn > 0;
  return {
    needsChatbot: true,
    status: status('cards.commands.status', answering ? 'ok' : 'off', { commands: rows.length, builtins: builtinsOn }),
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

// An amount in the tip page's currency, without ".00" for a whole one ("€5", "€7.50").
function moneyText(amount, currency, lang) {
  const n = Number(amount) || 0;
  const digits = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${n.toFixed(digits)} ${currency}`;
  }
}
const countText = (n, lang) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };

// Reading tips aloud on the Donations card: its switch only while the site offers it (an ElevenLabs key), the tip
// page has its email and the overlay features are shown (a tip is read only through the alert overlay); its line
// ("Reading tips from €5 · 2,340 of 15,000 characters") while it is on.
function tipVoiceOf(streamer, tts, currency, hasEmail, overlays) {
  if (!tts || !tts.available || !hasEmail || !overlays) return { tts: null, counts: {} };
  const on = !!streamer.tts_enabled;
  if (!on) return { tts: { on }, counts: { tts: plain('') } };
  const lang = tts.lang || 'en';
  return {
    tts: { on },
    counts: {
      tts: label('cards.donations.ttsOn', {
        amount: moneyText(streamer.tts_min_amount ?? 5, currency, lang), used: countText(tts.used, lang), limit: countText(tts.limit, lang),
      }),
    },
  };
}

function donationsCard({ streamer, tips, tipGoal, features, appUrl, now, tts }) {
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
  const voice = tipVoiceOf(streamer, tts, currency, hasEmail, !!features.overlays);
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
    tts: voice.tts,
    counts: voice.counts,
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

// A poll or prediction that keeps its kind busy on Twitch: running, or locked and waiting for its winner.
const busy = (view) => !!view && view.state !== 'ended';

// The Polls & predictions card's one setup step, from the streamer's row and whether Twitch gave the two permissions:
// link Twitch, reconnect, or Check again after Twitch said the channel is not an Affiliate or Partner; null once the
// card can start polls. routes/polls.js asks it too, so the live answers' status line is the card's.
function pollsSetup(streamer, hasScope) {
  if (!twitchLinked(streamer)) return 'linkTwitch';
  if (!hasScope) return 'reconnect';
  if (streamer.cp_affiliate_status === 'not_affiliate') return 'notAffiliate';
  return null;
}
const POLLS_SETUP_STATUS = Object.freeze({
  linkTwitch: 'cards.polls.status.noTwitch',
  reconnect: 'cards.polls.status.reconnect',
  notAffiliate: 'cards.polls.status.notAffiliate',
});

// The Polls & predictions card's status line: its setup step while it has one (pollsSetup()), else what runs
// (livePolls.snapshot()). GET /dashboard/api/polls/live answers it too, so the line follows the live panel.
function pollsStatus(live, templateCount, setup = null) {
  if (setup) return status(POLLS_SETUP_STATUS[setup], 'warn');
  const poll = live && live.poll;
  const prediction = live && live.prediction;
  if (prediction && prediction.state === 'locked') return status('cards.polls.status.locked', 'warn');
  if (busy(poll) && busy(prediction)) return status('cards.polls.status.bothRunning');
  if (busy(poll)) return status('cards.polls.status.pollRunning');
  if (busy(prediction)) return status('cards.polls.status.predictionRunning');
  if (prediction) return status('cards.polls.status.predictionEnded');
  if (poll) return status('cards.polls.status.pollEnded');
  if (templateCount === 1) return status('cards.polls.status.readyOne');
  return status('cards.polls.status.ready', 'ok', { count: templateCount });
}

// The Polls & predictions card: its one setup step (pollsSetup()), else the templates (▶ off for a kind that runs),
// what runs on Twitch now (the page script keeps the live panel up to date), the announcements and their six texts,
// Twitch's limits for the pop-up, and the bar's OBS link with the overlay features.
function pollsCard({ streamer, polls, pollTemplates, features }) {
  const setup = pollsSetup(streamer, polls.hasScope);
  const live = polls.live || { poll: null, prediction: null, serverNow: null };
  const announce = !!streamer.polls_chat_enabled;
  return {
    setup,
    status: pollsStatus(live, pollTemplates.length, setup),
    templates: pollTemplates.map((tpl) => ({
      id: tpl.id, kind: tpl.kind, title: tpl.title, choices: tpl.choices, durationSeconds: tpl.durationSeconds,
      pointsPerVote: tpl.pointsPerVote, time: timeLabel(tpl.durationSeconds),
    })),
    blocked: { poll: busy(live.poll), prediction: busy(live.prediction) },
    live,
    announce,
    chatNote: announce && !streamer.chatbot_enabled,
    texts: POLL_TEXTS.map((text) => ({ key: text.key, label: text.label, vars: text.vars, text: streamer[text.key] || '' })),
    limits: {
      poll: POLL_LIMITS.poll, prediction: POLL_LIMITS.prediction, pointsPerVote: POINTS_PER_VOTE,
      durations: DURATION_CHOICES, templatesMax: TEMPLATES_MAX,
    },
    bar: features.overlays ? pollBarLink(polls.barUrl) : null,
    counts: { templates: plain(pollTemplates.length) },
  };
}

// The Shoutouts card's example line, filled for a made-up channel.
const SHOUTOUT_SAMPLE = Object.freeze({ login: 'rivalracer', name: 'RivalRacer', game: 'iRacing', title: 'Night race at Spa' });

// The Shoutouts card: `!so @name` for moderators, the shoutout after a raid and its minimum, and the message (with
// Test in chat and an example line). Faded while the chatbot is off: the shoutouts are its lines.
function shoutoutsCard({ streamer }) {
  const command = !!streamer.shoutout_command_enabled;
  const raid = !!streamer.shoutout_raid_enabled;
  const viewers = Number(streamer.shoutout_raid_min_viewers) || 1;
  let st;
  if (command && raid) st = status('cards.shoutouts.status.both', 'ok', { viewers });
  else if (command) st = status('cards.shoutouts.status.command');
  else if (raid) st = status('cards.shoutouts.status.raid', 'ok', { viewers });
  else st = status('cards.shoutouts.status.off', 'off');
  const text = streamer.shoutout_template || '';
  return {
    needsChatbot: true,
    status: st,
    command,
    raid,
    viewers,
    viewerChoices: choices(RAID_MIN_VIEWERS, viewers),
    text,
    vars: ['{name}', '{game}', '{title}', '{link}'],
    sample: SHOUTOUT_SAMPLE,
    example: shoutoutLine(text, SHOUTOUT_SAMPLE),
    counts: {},
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
  chatbot: chatbotCard, discord: discordCard, overlay: overlayCard, tracking: trackingCard, commands: commandsCard, sponsors: sponsorsCard,
  donations: donationsCard, protection: protectionCard, giveaways: giveawaysCard, rewards: rewardsCard, spotify: spotifyCard,
  shoutouts: shoutoutsCard, polls: pollsCard,
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

module.exports = { buildCards, cardTexts, pollsStatus, pollsSetup, ORDER };
