'use strict';

// The pages of Task 16 (tip, dashboard, donation settings and history, giveaways,
// channel point rewards, sponsor messages) keep every word a person reads in the
// locale files. Three checks:
//   1. the views' source has no English typed into it (text, attributes, the
//      strings of inline scripts, string literals inside EJS tags);
//   2. every view renders in each of the 7 languages with sample data, and every
//      inline script parses;
//   3. rendered with a translator that answers each key as "[key]", no word of
//      English is left on the page, and every key it names exists in en.json.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const { t, SUPPORTED_LANGS } = require('../src/i18n');
const en = require('../src/locales/en.json');

const SRC = path.join(__dirname, '..', 'src');
const VIEWS = path.join(SRC, 'views');
const PAGES = ['tip', 'dashboard', 'donation-settings', 'donation-history', 'giveaways-config', 'redemptions-config', 'timed-notifications'];

// Words that stay as they are in every language: product names, units and codes.
const KEEP = new Set([
  'atleta', 'twitch', 'youtube', 'obs', 'paypal', 'streamelements', 'discord', 'spotify', 'vrm', 'utc', 'kick', 'tiktok', 'instagram', 'iracing',
  'eur', 'usd', 'gbp', 'brl', 'cad', 'aud',
]);
// "Atleta Personal Helper" is the product's name.
const PRODUCT_NAME = /Atleta Personal Helper/g;
// Typed into the markup on purpose: an example address, an example keyword, a URL stub.
const EXAMPLE_ATTRIBUTES = new Set(['your-email@paypal.com', 'gw', 'https://...']);

const words = (text) => (text.match(/[A-Za-z]{2,}/g) || []).filter((w) => !KEEP.has(w.toLowerCase()));
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#34;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·', '&mdash;': '—', '&rarr;': '→', '&larr;': '←', '&le;': '≤', '&bull;': '•', '&times;': '×' };
const decode = (text) => text.replace(/&[a-z#0-9]+;/gi, (m) => (ENTITIES[m] !== undefined ? ENTITIES[m] : m));
const literals = (code) => [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

// English that a person would read, found in an EJS view's source: [where, text] pairs.
function hardCodedText(source) {
  const found = [];
  const markup = source
    .replace(/<%#[\s\S]*?%>/g, ' ')
    .replace(/<%[\s\S]*?%>/g, '\u0001')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<code\b[\s\S]*?<\/code>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');

  // 1. text between tags
  for (const m of markup.matchAll(/>([^<>]+)</g)) {
    const text = decode(m[1].replace(/\u0001/g, ' ')).replace(PRODUCT_NAME, ' ').replace(/\/[a-z-]+\//g, ' ').replace(/\s+/g, ' ').trim();
    if (words(text).length) found.push(['text', text]);
  }
  // 2. attributes a person reads
  for (const m of markup.matchAll(/\s(placeholder|title|aria-label|alt|label)="([^"]*)"/g)) {
    const text = decode(m[2].replace(/\u0001/g, ' ')).trim();
    if (!EXAMPLE_ATTRIBUTES.has(text) && words(text).length) found.push([m[1], text]);
  }
  // 3. strings inside inline event handlers (confirm('...'), alert('...'))
  for (const m of markup.matchAll(/\son[a-z]+="([^"]*)"/g)) {
    for (const lit of literals(m[1])) if (/^[A-Z][a-z]+(?:\s+\S+)+/.test(lit)) found.push(['handler', lit]);
  }
  // 4. English literals inside EJS tags: <%= flag ? 'Enabled' : 'Disabled' %>
  for (const m of source.matchAll(/<%([=-]?)([\s\S]*?)%>/g)) {
    if (m[2].startsWith('#')) continue;
    const code = m[2].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const lit of literals(code)) {
      if (/^[A-Z][a-z]{2,}/.test(lit) && words(lit).length) found.push(['ejs', lit]);
    }
  }
  // 5. sentences in the inline scripts (not the ones only written to the console)
  for (const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const js = m[1]
      .replace(/<%[\s\S]*?%>/g, '\u0001')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[\s;{}(])\/\/[^\n]*/g, '$1')
      .split('\n').filter((line) => !/\bconsole\.[a-z]+\(/.test(line)).join('\n');
    for (const lit of literals(js)) {
      const text = lit.replace(/<[^>]*>/g, ' ').replace(/\u0001/g, ' ').trim();
      if (/^[A-Z][A-Za-z]+(?:\s+\S+)+/.test(text) && words(text).length >= 2) found.push(['script', text]);
    }
  }
  return found;
}

describe('the views have no English typed into them', () => {
  for (const page of PAGES) {
    test(page, () => {
      const found = hardCodedText(fs.readFileSync(path.join(VIEWS, `${page}.ejs`), 'utf8'));
      assert.deepEqual(found, [], `typed into ${page}.ejs instead of a t('key'):\n  ${found.map(([where, text]) => `${where}: ${text}`).join('\n  ')}`);
    });
  }

  test('the dashboard\'s card partials (views/cards/)', () => {
    for (const file of fs.readdirSync(path.join(VIEWS, 'cards')).filter((name) => name.endsWith('.ejs'))) {
      const found = hardCodedText(fs.readFileSync(path.join(VIEWS, 'cards', file), 'utf8'));
      assert.deepEqual(found, [], `typed into cards/${file} instead of a t('key'):\n  ${found.map(([where, text]) => `${where}: ${text}`).join('\n  ')}`);
    }
  });

  test('the check itself finds what it is looking for', () => {
    const bad = [
      ['<p>Save everything now</p>', 'text'],
      ['<h3>Enabled</h3>', 'text'],
      ['<input placeholder="Type here">', 'placeholder'],
      ['<button title="Copy it">x</button>', 'title'],
      ['<form onsubmit="return confirm(\'Delete this now?\');">', 'handler'],
      ['<span><%= on ? \'Enabled\' : x %></span>', 'ejs'],
      ['<script>showToast(\'Something went wrong\');</script>', 'script'],
      ['<script>alert("Please pick a file");</script>', 'script'],
    ];
    for (const [source, where] of bad) {
      assert.ok(hardCodedText(source).some(([w]) => w === where), `finds ${where} in ${source}`);
    }
    const fine = [
      '<p><%= t(\'a.b\') %></p>',
      '<p>Twitch · YouTube</p>',
      '<a href="/">Atleta Personal Helper</a>',
      '<input placeholder="your-email@paypal.com">',
      '<code>!song</code>',
      '<script>console.error(\'Failed to load models\');  // Failed to load models\n showToast(T.done);</script>',
      '<p><%# A comment about the page %></p>',
    ];
    for (const source of fine) assert.deepEqual(hardCodedText(source), [], source);
  });
});

// ── Sample data ──────────────────────────────────────────────────────────

const streamerRow = (over = {}) => ({
  id: 1, twitch_username: 'zzchannel', twitch_display_name: 'zzname', twitch_user_id: '1', broadcaster_access_token: 'x',
  overlay_enabled: 1, overlay_token: 'zztoken', chatbot_enabled: 1, spotify_access_token: 'x', paypal_email: 'a@b.co',
  donation_page_enabled: 1, donation_currency: 'EUR', donation_min_amount: 1, cp_affiliate_status: 'ok', cp_rewards_enabled: 0,
  multistream_enabled: 1, yt_chatbot_enabled: 0, vtuber_model_id: null, sponsor_send_chat: 1, sponsor_chat_interval_minutes: 10, ...over,
});
const stats = { live_count: 1, clip_count: 2, recap_count: 3, milestone_count: 4, youtube_video_count: 5, youtube_live_count: 6, digest_count: 7, week_total: 8, total: 9 };
const guild = { guild_id: '1', name: 'zzserver', icon: null, botPresent: true, twitchCount: 1, youtubeCount: 2, stats, chartData: [{ period: '2026-10-01', twitch_live: 2, youtube_live: 1 }] };
// The Discord notifications card (discordNotificationsCard() in routes/dashboard.js): servers in every state.
const notifyServer = (over = {}) => ({
  guildId: '1', name: 'zzserver', icon: null, botPresent: true, url: '/dashboard/guild/1',
  goLive: { state: 'on', where: '#zzlive' }, clips: { state: 'off', where: null }, recaps: 'on', milestones: 'wait', highlights: 'off', subRoles: 'wait',
  switches: { goLive: true, clips: false, recaps: true, milestones: true, highlights: false, subRoles: true },
  liveWhere: '#zzlive', clipsWhere: null, hasLiveChannel: true, hasClipsChannel: false, hasSubRole: true, ...over,
});
const discordNotifications = {
  twitchLinked: true, announcing: 1, needsAuth: true, authAction: 'reconnect',
  servers: [notifyServer(), notifyServer({
    guildId: '2', name: 'zzquiet', botPresent: false, url: '/dashboard/guild/2?tab=twitch', goLive: { state: 'off', where: null }, milestones: 'off', subRoles: 'on', recaps: 'off',
    switches: { goLive: false, clips: false, recaps: true, milestones: false, highlights: true, subRoles: true }, liveWhere: null, hasLiveChannel: false, hasSubRole: false,
  })],
};
const months = (total) => Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, total: total(i), count: i % 3 }));

// Each page with data that shows its branches: [name, locals]
const SAMPLES = {
  tip: [
    ['form', { streamer: streamerRow(), avatarUrl: null, success: false, error: null }],
    ['thanks', { streamer: streamerRow(), avatarUrl: null, success: true, error: null }],
  ],
  dashboard: [
    ['everything on', {
      streamer: streamerRow({ yt_chatbot_enabled: 1 }), guilds: [guild, { ...guild, guild_id: '2', botPresent: false, twitchCount: 0, youtubeCount: 0, chartData: [] }],
      unclaimedGuilds: [{ id: '3', name: 'zzother', icon: null }], botInviteUrl: 'https://example.test/invite', msg: 'spotify_error', botConnected: true, botUsername: 'zzbot',
      overlayUrl: 'https://example.test/overlay/zztoken', overlayStats: { total: 3, follows: 1, subs: 1, bits_events: 1, donations: 0, raids: 0, giftsubs: 0 },
      vtuberUrl: null, hasScope: false, needsReauth: true, activeGiveaway: { keyword: 'zzword' }, multistreamAvailable: true, isAdmin: true, features: { youtube: true, kick: true },
      discordNotifications,
    }],
    ['nothing set up', {
      streamer: streamerRow({ twitch_user_id: null, broadcaster_access_token: null, overlay_enabled: 0, chatbot_enabled: 0, spotify_access_token: null, paypal_email: null, donation_page_enabled: 0, cp_affiliate_status: 'not_affiliate', multistream_enabled: 0 }),
      guilds: [], unclaimedGuilds: [], botInviteUrl: 'https://example.test/invite', msg: 'spotify_connected', botConnected: false, botUsername: '',
      overlayUrl: null, overlayStats: null, vtuberUrl: null, hasScope: true, needsReauth: false, activeGiveaway: null, multistreamAvailable: false, isAdmin: false, features: { youtube: false },
      discordNotifications: { twitchLinked: false, servers: [], announcing: 0, needsAuth: false, authAction: 'enable' },
    }],
    ['connected, bot ready but off', {
      streamer: streamerRow({ chatbot_enabled: 0, cp_rewards_enabled: 1 }), guilds: [], unclaimedGuilds: [], botInviteUrl: 'https://example.test/invite', msg: undefined, botConnected: true, botUsername: '',
      overlayUrl: 'https://example.test/overlay/zztoken', overlayStats: null, vtuberUrl: 'https://example.test/vtuber/zztoken', hasScope: true, needsReauth: false, activeGiveaway: null, multistreamAvailable: true, isAdmin: false, features: { youtube: true },
      discordNotifications: { twitchLinked: true, servers: [], announcing: 0, needsAuth: false, authAction: 'enable' },
    }],
    ['Twitch linked, one server announcing, another to claim, YouTube and Kick off', {
      streamer: streamerRow({ broadcaster_access_token: null }), guilds: [guild], unclaimedGuilds: [{ id: '3', name: 'zzother', icon: null }], botInviteUrl: 'https://example.test/invite', msg: 'youtube_saved',
      botConnected: true, botUsername: 'zzbot', overlayUrl: null, overlayStats: null, vtuberUrl: null, hasScope: true, needsReauth: false, activeGiveaway: null, multistreamAvailable: false, isAdmin: false,
      features: { youtube: false, kick: false },
      discordNotifications: {
        twitchLinked: true, announcing: 1, needsAuth: false, authAction: 'enable',
        servers: [notifyServer({
          clips: { state: 'on', where: '#zzclips' }, milestones: 'on', subRoles: 'off',
          switches: { goLive: true, clips: true, recaps: true, milestones: true, highlights: false, subRoles: false }, clipsWhere: '#zzclips', hasClipsChannel: true,
        })],
      },
    }],
    ['Twitch linked, no server yet, one to claim', {
      streamer: streamerRow(), guilds: [], unclaimedGuilds: [{ id: '3', name: 'zzother', icon: null }], botInviteUrl: 'https://example.test/invite', msg: 'spotify_disconnected', botConnected: false, botUsername: '',
      overlayUrl: null, overlayStats: null, vtuberUrl: null, hasScope: true, needsReauth: false, activeGiveaway: null, multistreamAvailable: false, isAdmin: false, features: { youtube: false },
      discordNotifications: { twitchLinked: true, servers: [], announcing: 0, needsAuth: false, authAction: 'enable' },
    }],
  ],
  'donation-settings': [
    ['a goal is running', { streamer: streamerRow(), appUrl: 'https://example.test', activeGoal: { id: 1, title: 'zzgoal', currency: 'EUR', target_amount: 100, current_amount: 5, bar_color: '#22c55e' }, goalHistory: [{ title: 'zzold', currency: 'USD', current_amount: 5, target_amount: 10, completed_at: 'x', created_at: '2026-01-01' }], goalOverlayUrl: 'https://example.test/overlay/goal/zztoken', settingsError: 'zzerror', goalError: 'zzerror', goalCurrencyWarning: 'zzwarning' }],
    ['no goal, no overlay link', { streamer: streamerRow({ twitch_username: null, paypal_email: null }), appUrl: 'https://example.test', activeGoal: null, goalHistory: [], goalOverlayUrl: null, settingsError: null, goalError: null, goalCurrencyWarning: null }],
  ],
  'donation-history': [
    ['with donations', { streamer: streamerRow(), filters: { range: '30d', source: 'legacy' }, donations: [{ id: 1, created_at: '2026-10-01 10:00:00', donor_name: null, amount: 5, currency: 'EUR', source: 'paypal', message: 'zzmessage' }, { id: 2, created_at: '2026-10-02 10:00:00', donor_name: 'zzdonor', amount: 1, currency: 'USD', source: 'legacy', message: '' }], total: 2, page: 2, pages: 3, totals: [{ currency: 'EUR', total: 5, count: 1, biggest: 5 }, { currency: 'USD', total: 1, count: 2, biggest: 1 }], months: months((i) => i), chartCurrency: 'EUR', otherCurrencies: ['USD'] }],
    ['nothing yet', { streamer: streamerRow(), filters: { range: '7d', source: '' }, donations: [], total: 0, page: 1, pages: 1, totals: [], months: months(() => 0), chartCurrency: null, otherCurrencies: [] }],
  ],
  'giveaways-config': [
    ['one is running', { streamer: streamerRow(), active: { id: 1, keyword: 'zzword', prize: 'zzprize', subs_only: 1, ends_at: '2026-10-14 10:00:00' }, history: [{ id: 1, started_at: '2026-10-01 10:00:00', keyword: 'zzword', prize: null, winners_count: 2 }], recentWinners: [] }],
    ['open to all, no end', { streamer: streamerRow(), active: { id: 2, keyword: 'zzword', prize: null, subs_only: 0, ends_at: null }, history: [], recentWinners: [] }],
    ['none running, with winners', { streamer: streamerRow(), active: null, history: [{ id: 1, started_at: '2026-10-01 10:00:00', keyword: 'zzword', prize: 'zzprize', winners_count: 2 }], recentWinners: [{ username: 'zzone' }, { username: 'zztwo' }] }],
    ['none running, never', { streamer: streamerRow(), active: null, history: [], recentWinners: [] }],
  ],
  'redemptions-config': [
    ['rewards and every outcome', {
      streamer: streamerRow(),
      rewards: [
        { id: 1, title: 'zzone', cost: 500, media_type: 'audio', position_preset: 'center-large', twitch_sync_status: 'orphaned', enabled: 1 },
        { id: 2, title: 'zztwo', cost: 1500, media_type: 'video', position_preset: 'top-right-small', twitch_sync_status: 'update_failed', enabled: 0 },
        { id: 3, title: 'zzthree', cost: 10, media_type: 'audio', position_preset: 'custom', twitch_sync_status: 'create_failed', enabled: 1 },
      ],
      pendingDeletes: [{ id: 4, title: 'zzgone', cost: 20 }], allRewards: [{ id: 1, title: 'zzone' }],
      recentRedemptions: ['played', 'refunded_no_file', 'refunded_disabled', 'refunded_deleted', 'refunded_switch_off', 'disabled', 'error', 'pending', 'zzoutcome']
        .map((outcome, i) => ({ id: i + 1, reward_id: 1, created_at: '2026-10-01 10:00:00', user_login: i === 0 ? null : 'zzviewer', cost: i === 1 ? null : 500, outcome, is_test: 0 }))
        .concat([{ id: 20, reward_id: 99, twitch_reward_id: 'zzid', created_at: '2026-10-01 10:00:00', user_login: 'zzviewer', cost: 5, outcome: 'test', is_test: 1 }]),
      cpRewardsEnabled: 0, affiliateStatus: 'not_affiliate', lastSyncAt: '2026-10-01 10:00:00', hasScope: false,
    }],
    ['empty, switch on', { streamer: streamerRow({ cp_rewards_enabled: 1 }), rewards: [], pendingDeletes: [], allRewards: [], recentRedemptions: [], cpRewardsEnabled: 1, affiliateStatus: 'ok', lastSyncAt: null, hasScope: true }],
  ],
  'timed-notifications': [
    ['with messages', { streamer: streamerRow(), messages: [{ id: 1, message_text: 'zzmessage', url: 'https://youtube.test/zz', enabled: 1 }, { id: 2, message_text: 'zzother', url: null, enabled: 0 }] }],
    ['none', { streamer: streamerRow({ sponsor_send_chat: 0 }), messages: [] }],
  ],
};

const { buildCards } = require('../src/services/dashboardCards');
// What GET /dashboard gathers for the working cards (gatherCards() in routes/dashboard.js), from a sample's locals:
// a sample with the bot connected also has commands, sponsor messages, tips, a goal, a reward and a giveaway.
function sampleCards(data, features) {
  const full = !!data.botConnected;
  return buildCards({
    streamer: data.streamer,
    features,
    now: Date.parse('2026-10-14T12:00:00Z'),
    appUrl: 'https://example.test',
    bot: { connected: full, moderator: full ? false : null, username: data.botUsername || '' },
    overlay: { url: data.overlayUrl, open: !!data.overlayUrl },
    discord: data.discordNotifications,
    // (the database always has the column: the second command is switched off, the others are on)
    commands: full ? [1, 2, 3, 4, 5].map((n) => ({ id: n, command: `zzcmd${n}`, response: `zzresponse${n}`, cooldown: 7, enabled: n === 2 ? 0 : 1 })) : [],
    bannedWords: { total: 2, regex: 0 },
    modActionsThisWeek: 3,
    sponsorMessages: full ? [1, 2, 3, 4].map((n) => ({ id: n, message_text: `zzsponsor${n}`, url: n === 1 ? 'https://example.test/zz' : null, enabled: n % 2 })) : [],
    tips: {
      count90d: full ? 2 : 0,
      recent: full ? [{ id: 1, amount: 5, currency: 'EUR', donor_name: 'zzdonor', message: 'zzmessage', created_at: '2026-10-12 10:00:00' }, { id: 2, amount: 2.5, currency: 'USD', donor_name: null, message: '', created_at: '2026-10-14 11:59:30' }] : [],
    },
    tipGoal: full ? { title: 'zzgoal', current_amount: 101, target_amount: 1000, currency: 'EUR' } : null,
    rewards: full ? [{ id: 1, title: 'zzreward', cost: 500, enabled: 1 }, { id: 2, title: 'zzpaused', cost: 50, enabled: 0 }] : [],
    rewardsAccess: { hasScope: data.hasScope },
    giveaway: data.activeGiveaway ? { id: 3, keyword: 'zzword', prize: 'zzprize', ends_at: '2026-10-14T12:05:00.000Z', winners_count: 2, subs_only: 1, entryCount: 4 } : null,
    spotifyConnected: !!data.streamer.spotify_access_token,
    multistreamAvailable: !!data.multistreamAvailable && !!features.youtube,
  });
}

// These pages show less while the overlay features are off (features.overlays): each of their samples is rendered
// both ways. The dashboard's VTuber tab has its own switch (features.vtuber) and shows only with the overlays, so
// the samples get that switch together with them.
const OVERLAY_SWITCH_PAGES = ['dashboard', 'donation-settings', 'timed-notifications'];
for (const page of OVERLAY_SWITCH_PAGES) {
  SAMPLES[page] = SAMPLES[page].flatMap(([name, data]) => [true, false].map((overlays) => {
    const features = { ...(data.features || { youtube: true }), overlays, vtuber: overlays };
    const locals = { ...data, features };
    if (page === 'dashboard') locals.cards = sampleCards(data, features);
    return [`${name}, overlay features ${overlays ? 'on' : 'off'}`, locals];
  }));
}

// What header.ejs and the layout need besides a page's own data.
const layout = (lang, translate) => ({
  t: translate || ((key, params) => t(lang, key, params)), lang, SUPPORTED_LANGS, currentPath: '/', isAdmin: false, notifications: [], unreadNotifCount: 0,
  racingUser: null, features: { youtube: true }, csrfToken: 'zztoken', streamerTier: 'free',
});

const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

describe('every page renders in every language, and its scripts parse', () => {
  for (const lang of SUPPORTED_LANGS) {
    test(lang, async () => {
      for (const page of PAGES) {
        for (const [name, data] of SAMPLES[page]) {
          const html = await ejs.renderFile(path.join(VIEWS, `${page}.ejs`), { ...layout(lang), ...data }, { views: [VIEWS] });
          const where = `${page} / ${name} / ${lang}`;
          assert.ok(html.length > 500, where);
          // (the scripts may say undefined themselves)
          const outsideScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
          assert.ok(!/\bundefined\b/.test(outsideScripts), `${where}: a value is missing`);
          assert.ok(!html.includes('[object Object]'), where);
          assert.ok(!/\{\{\w+\}\}/.test(outsideScripts), `${where}: a {{placeholder}} is left in the page`);
          inlineScripts(html).forEach((script, i) => {
            assert.doesNotThrow(() => new vm.Script(script), `${where}: inline script #${i} does not parse`);
          });
        }
      }
    });
  }

  test('the page language is the visit\'s', async () => {
    const html = await ejs.renderFile(path.join(VIEWS, 'tip.ejs'), { ...layout('ja'), ...SAMPLES.tip[0][1] }, { views: [VIEWS] });
    assert.match(html, /<html lang="ja">/);
  });
});

// ── Rendered with the keys themselves ────────────────────────────────────

describe('rendered with each message as its key, no English is left on the page', () => {
  let dir;
  before(() => {
    // The page's own markup only: the layout (header, footer) belongs to other work.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-views-'));
    for (const page of PAGES) fs.copyFileSync(path.join(VIEWS, `${page}.ejs`), path.join(dir, `${page}.ejs`));
    fs.cpSync(path.join(VIEWS, 'cards'), path.join(dir, 'cards'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'header.ejs'), '<!DOCTYPE html><html><head><title><%= typeof title !== "undefined" ? title : "" %></title></head><body>');
    fs.writeFileSync(path.join(dir, 'footer.ejs'), '</body></html>');
    fs.writeFileSync(path.join(dir, 'csrf.ejs'), '');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Words the browser's own data adds: currency names and short month names (Intl).
  const INTL = new Set(['euro', 'us', 'dollar', 'british', 'pound', 'brazilian', 'real', 'canadian', 'australian', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);

  for (const page of PAGES) {
    test(page, async () => {
      for (const [name, data] of SAMPLES[page]) {
        // every call is recorded: a text's {{placeholders}} must all be given a value
        const calls = [];
        const echo = (key, params) => { calls.push([key, Object.keys(params || {})]); return `[${key}]`; };
        const html = await ejs.renderFile(path.join(dir, `${page}.ejs`), { ...layout('en', echo), ...data }, { views: [dir] });
        const where = `${page} / ${name}`;

        const unfilled = calls
          .filter(([key]) => key in en)
          .map(([key, given]) => [key, [...en[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((placeholder) => !given.includes(placeholder))])
          .filter(([, missing]) => missing.length);
        assert.deepEqual(unfilled, [], `${where}: placeholders given no value`);

        // The keys named in the markup, and in the quoted strings of the scripts (their text tables)
        const markupOnly = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
        const KEY = /\[([A-Za-z]\w*(?:\.\w+)+)\]/g;
        const named = new Set([...markupOnly.matchAll(KEY), ...html.matchAll(/"\[([A-Za-z]\w*(?:\.\w+)+)\][^"]*"/g)].map((m) => m[1]));
        const unknown = [...named].filter((key) => !(key in en));
        assert.deepEqual(unknown, [], `${where}: keys that en.json does not have`);

        const attributes = [...html.matchAll(/\s(?:placeholder|title|aria-label|alt)="([^"]*)"/g)].map((m) => decode(m[1])).filter((value) => !EXAMPLE_ATTRIBUTES.has(value));
        const text = markupOnly
          .replace(/<code\b[\s\S]*?<\/code>/gi, ' ').replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
          .replace(/<[^>]*>/g, '\u0002')
          .concat(attributes.map((value) => `\u0002${value}\u0002`).join(''));
        const left = [];
        for (const piece of text.split('\u0002')) {
          const plain = decode(piece).replace(/\[[\w.]+\]/g, ' ').replace(PRODUCT_NAME, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\/[a-z-]+\/\S*/g, ' ');
          for (const w of words(plain)) {
            if (/^zz/i.test(w) || INTL.has(w.toLowerCase())) continue;
            left.push(w);
          }
        }
        assert.deepEqual([...new Set(left)], [], `${where}: words that are not from a key`);
      }
    });
  }
});

// ── The overlay features switched off (features.overlays) ────────────────

describe('while the overlay features are off, the pages say nothing about the overlays', () => {
  // The wording that says a text is about the overlays. Left out: the multistream card, which names OBS because the
  // relay is fed from it, and the layout's own site description (common.siteDescription, the link preview in
  // header.ejs), which is not a text of these pages.
  const ABOUT_OVERLAYS = /overlay|\bOBS\b|browser source|vtuber|channel point|tip goal|goal bar|progress bar/i;
  const NOT_ABOUT_OVERLAYS = /^(?:dashboard\.cards\.multistream\.|common\.siteDescription$)/;

  // Every key a page asks t() for while it renders one sample.
  async function keysAsked(page, data) {
    const keys = new Set();
    const record = (key, params) => { keys.add(key); return t('en', key, params); };
    await ejs.renderFile(path.join(VIEWS, `${page}.ejs`), { ...layout('en', record), ...data }, { views: [VIEWS] });
    return keys;
  }
  const samples = (page, overlays) => SAMPLES[page].filter(([name]) => name.endsWith(`overlay features ${overlays ? 'on' : 'off'}`));

  for (const page of OVERLAY_SWITCH_PAGES) {
    test(`${page}: asks for no text about them`, async () => {
      assert.ok(samples(page, false).length > 0);
      for (const [name, data] of samples(page, false)) {
        const about = [...await keysAsked(page, data)].filter((key) => !NOT_ABOUT_OVERLAYS.test(key) && ABOUT_OVERLAYS.test(en[key]));
        assert.deepEqual(about, [], `${page} / ${name} asks for texts about the overlays`);
      }
    });
  }

  test('switched on, they ask for the texts about them again', async () => {
    const wanted = {
      dashboard: ['dashboard.cards.overlay.title', 'dashboard.cards.cpRewards', 'dashboard.vtuber.title', 'dashboard.tab.experimental',
        'dashboard.youtube.overlayDesc', 'cards.overlay.source', 'cards.donations.goal', 'cards.sponsors.images'],
      'donation-settings': ['donations.settings.intro', 'donations.goal.title', 'donations.goal.testLive', 'donations.goalOverlay.title', 'donations.goal.past'],
      'timed-notifications': ['sponsors.intro', 'sponsors.builderLink'],
    };
    for (const page of OVERLAY_SWITCH_PAGES) {
      const asked = new Set();
      for (const [, data] of samples(page, true)) for (const key of await keysAsked(page, data)) asked.add(key);
      assert.deepEqual(wanted[page].filter((key) => !asked.has(key)), [], `${page} no longer asks for a text it asked for before`);
    }
  });

  // The texts that replace them (src/locales): none of them says overlay, in any language.
  const REPLACEMENTS = [
    'donations.settings.introChat', 'sponsors.introChat',
    'ytChatbot.eventsChat', 'ytChatbot.eventsHintChat', 'dashboard.kick.comingSoonChat', 'account.disabled.bodyChat',
  ];
  const OVERLAY_IN_ANY_LANGUAGE = /overlay|\bOBS\b|browser|navegador|navigateur|叠加|オーバーレイ|ブラウザ/i;
  for (const lang of SUPPORTED_LANGS) {
    test(`${lang}: the texts that replace them do not mention them`, () => {
      const texts = JSON.parse(fs.readFileSync(path.join(SRC, 'locales', `${lang}.json`), 'utf8'));
      for (const key of REPLACEMENTS) {
        assert.ok(typeof texts[key] === 'string' && texts[key].trim() !== '', `${lang}: ${key} is a text`);
        assert.ok(!OVERLAY_IN_ANY_LANGUAGE.test(texts[key]), `${lang}: ${key} mentions the overlays: ${texts[key]}`);
      }
    });
  }
});

// ── YouTube and Kick switched off (features.youtube, features.kick) ──────

describe('while YouTube and Kick are switched off, the dashboard asks for no text about them', () => {
  async function keysAsked(data) {
    const keys = new Set();
    const record = (key, params) => { keys.add(key); return t('en', key, params); };
    await ejs.renderFile(path.join(VIEWS, 'dashboard.ejs'), { ...layout('en', record), ...data }, { views: [VIEWS] });
    return keys;
  }
  const off = (flag) => SAMPLES.dashboard.filter(([, data]) => !data.features[flag]);
  const on = (flag) => SAMPLES.dashboard.filter(([, data]) => data.features[flag]);
  const CASES = { youtube: /youtube|super ?chat/i, kick: /\bkick\b/i };

  for (const [flag, about] of Object.entries(CASES)) {
    test(`${flag}: no text about it while it is off, the texts about it again while it is on`, async () => {
      assert.ok(off(flag).length > 0 && on(flag).length > 0);
      for (const [name, data] of off(flag)) {
        const asked = [...await keysAsked(data)].filter((key) => about.test(en[key]));
        assert.deepEqual(asked, [], `${name} asks for texts about ${flag}`);
      }
      const askedOn = new Set();
      for (const [, data] of on(flag)) for (const key of await keysAsked(data)) if (about.test(en[key])) askedOn.add(key);
      assert.ok(askedOn.size > 0, `switched on, the dashboard talks about ${flag} again`);
    });
  }
});

// ── The keys the pages and their routes use ──────────────────────────────

describe('the keys', () => {
  const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');
  const keysIn = (source) => new Set([...source.matchAll(/\bt\(\s*(?:[a-z]+,\s*)?['"`]([A-Za-z][\w]*(?:\.[\w]+)+)['"`]/g)].map((m) => m[1]));

  test('every key a page or route names is in en.json', () => {
    const files = [...PAGES.map((p) => `views/${p}.ejs`), 'routes/tip.js', 'routes/dashboard.js', 'services/uploadValidation.js'];
    for (const file of files) {
      const source = read(file);
      const missing = [...keysIn(source)].filter((key) => !(key in en));
      assert.deepEqual(missing, [], `${file} uses keys en.json does not have`);
    }
    // uploadValidation.js names its keys as plain strings, for the route to translate
    for (const key of read('services/uploadValidation.js').match(/'redemptions\.error\.\w+'/g)) assert.ok(JSON.parse(`"${key.slice(1, -1)}"`) in en, key);
  });

  test('no key of these pages is left unused', () => {
    const ownPrefixes = /^(tip|donations|redemptions|giveaways|sponsors)\./;
    const code = [];
    (function collect(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'locales') collect(full); } else if (/\.(js|ejs)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) code.push(fs.readFileSync(full, 'utf8'));
      }
    })(SRC);
    const all = code.join('\n');
    const unused = Object.keys(en).filter((key) => ownPrefixes.test(key) && !all.includes(`'${key}'`) && !all.includes(`"${key}"`) && !all.includes(`\`${key}\``));
    assert.deepEqual(unused, [], 'keys nothing uses: delete them');
  });

  test('t() fills {{placeholders}} and leaves the single braces of a chat template alone', () => {
    assert.equal(t('en', 'tip.minAmount', { min: 2.5, currency: 'EUR' }), 'Minimum donation is 2.5 EUR');
    assert.equal(t('en', 'giveaways.toast.won', { names: '@a, @b' }), '@a, @b won!');
    assert.equal(t('en', 'redemptions.placeholder.chat'), '{user} redeemed {title} for {cost} points!');
  });

  test('the {{placeholders}} a text names are plain words', () => {
    for (const [key, text] of Object.entries(en)) {
      if (!/^(tip|donations|redemptions|giveaways|sponsors|dashboard)\./.test(key)) continue;
      for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) assert.match(m[1], /^\w+$/, `${key}: {{${m[1]}}}`);
    }
  });
});
