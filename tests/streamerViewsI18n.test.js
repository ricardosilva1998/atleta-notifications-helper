'use strict';

// The streamer pages must not carry user-visible English of their own: every text, placeholder,
// tooltip and message goes through t(). Three checks:
//   1. the page source has no words outside t() (scripts, styles, comments and EJS tags removed);
//   2. the page, rendered with a t() that wraps what it returns in « », has no word outside the
//      « » (this also catches text next to an EJS value, which the source check can only guess at);
//   3. the texts a page hands its script are all there: every I18N.<name> the script reads is in
//      the object the server renders, and the scripts parse.
// What is allowed to stay is listed below with the reason.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { t } = require('../src/i18n');
const en = require('../src/locales/en.json');
const { EVENT_DEFAULTS } = require('../src/services/overlayDesign');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const PAGES = [
  'guild-config', 'overlay-config', 'overlay-builder', 'chatbot-config', 'mod-log', 'youtube-chatbot-config', 'multistream',
  // linked from the site's menus, or the pages a streamer meets before logging in
  'account', 'report-issue', 'tutorial', 'donate', 'streamer-landing', 'login', 'guild-stats', 'link-result',
];

// Words that are not the page's own wording and may stay in every page: product names and units.
// A text node made only of these (or of command names and {variables}) is fine.
const ALLOWED_WORDS = new Set([
  'Twitch', 'YouTube', 'Discord', 'Kick', 'iRacing', 'StreamElements', 'OBS', 'Atleta', 'PayPal', 'Spotify',
  'px', 'kbps', 'AAC', 'NVENC', 'x264', 'min', 'sec', 'FPS', 'EUR', // 'EUR' is the amount of a fixed PayPal.me link
]);
// What one page may keep besides that, and why.
const PAGE_WORDS = {
  'overlay-builder': [
    // the font names in the picker (the stored value is the name)
    'Outfit', 'Inter', 'Poppins', 'Roboto', 'Mono', 'Press', 'Start', 'Permanent', 'Marker', 'Bangers', 'System', 'Default',
    // the sample alert content the previews show (what a streamer's own alert texts replace)
    'New', 'Pit', 'Crew', 'Member', 'RacerName', 'just', 'joined', 'the', 'race', 'Follower',
    'up', 'down', 'left', 'right', // the values of the hidden direction control
  ],
  'chatbot-config': ['socials'], // the example in the command-name placeholder
  'overlay-config': ['eyJhbGciOi'], // the example in the StreamElements token placeholder
};

// ── 1. The page source ───────────────────────────────────────────────────

function mask(source) {
  const fill = (m) => '\u0001'.repeat(m.length);
  return source
    .replace(/<%[\s\S]*?%>/g, fill)
    .replace(/<!--[\s\S]*?-->/g, fill)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, b, c) => a + fill(b) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, b, c) => a + fill(b) + c);
}
const decode = (s) => s.replace(/&(nbsp|amp|lt|gt|quot|bull|middot|rarr|larr|times|mdash|ndash|hellip);|&#\d+;/g, ' ');

// Words of two or more letters in a piece of plain page text that are not allowed to stay.
function strayWords(text, page) {
  const allowed = new Set(PAGE_WORDS[page] || []);
  const plain = decode(text).replace(/\u0001/g, ' ');
  if (/^\s*[!{#/@][\w{}.:#-]*\s*$/.test(plain)) return []; // a command name or a {variable}
  return (plain.match(/[A-Za-z][A-Za-z0-9_']+/g) || []).filter((w) => !ALLOWED_WORDS.has(w) && !allowed.has(w) && !/[_0-9]/.test(w));
}

describe('the page source has no text of its own', () => {
  for (const page of PAGES) {
    test(page, () => {
      const source = fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8');
      const masked = mask(source);
      const line = (i) => source.slice(0, i).split('\n').length;
      const found = [];
      for (const m of masked.matchAll(/>([^<>]*)</g)) {
        const words = strayWords(m[1], page);
        if (words.length) found.push(`line ${line(m.index + 1)}: ${m[1].replace(/\s+/g, ' ').trim().slice(0, 80)}`);
      }
      for (const m of masked.matchAll(/\s(placeholder|title|alt|aria-label|label)="([^"]*)"/g)) {
        const words = strayWords(m[2], page);
        if (words.length) found.push(`line ${line(m.index)}: ${m[1]}="${m[2].slice(0, 60)}"`);
      }
      assert.deepEqual(found, [], `${page}.ejs has text outside t():\n  ${found.join('\n  ')}`);
    });
  }
});

describe('the page source asks only for keys that exist', () => {
  for (const page of PAGES) {
    test(page, () => {
      const source = fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8');
      // t('prefix.' + name) asks for a family of keys: some key must start with the prefix
      const exists = (key) => (key.endsWith('.') ? Object.keys(en).some((k) => k.startsWith(key)) : key in en);
      const missing = [...new Set([...source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map((m) => m[1]))].filter((key) => !exists(key));
      assert.deepEqual(missing, [], `${page}.ejs uses keys that en.json does not have`);
    });
  }
});

// ── 2. The rendered page ─────────────────────────────────────────────────

const streamer = {
  id: 3, discord_username: 'tester', discord_display_name: 'Tester', twitch_username: 'tester_tv', twitch_display_name: 'Tester_TV', twitch_user_id: '99',
  overlay_token: 'tok123', overlay_enabled: 1, overlay_volume: 0.8,
  overlay_follow_enabled: 1, overlay_follow_duration: 5, overlay_sub_enabled: 1, overlay_sub_duration: 7,
  overlay_bits_enabled: 1, overlay_bits_duration: 6, overlay_donation_enabled: 1, overlay_donation_duration: 6,
  overlay_raid_enabled: 1, overlay_raid_duration: 7, overlay_giveaway_enabled: 1,
  chatbot_enabled: 1, chat_follow_enabled: 1, chat_sub_enabled: 1, chat_follow_template: 'Thanks_{username}',
  cmd_followage_enabled: 1, cmd_8ball_enabled: 1, mod_banned_words_enabled: 1, mod_link_protection_enabled: 1, mod_action_response: 'timeout_60',
  mod_exempt_subs: 1, mod_exempt_vips: 0,
  yt_access_token: 'yt', yt_channel_name: 'ChannelName', yt_chatbot_enabled: 1, yt_mod_enabled: 1, yt_chat_superchat_enabled: 1,
  yt_chat_superchat_template: 'Thanks_{username}', sponsor_rotation_enabled: 1,
};
const channels = [{ id: '111', name: 'general' }];
const limits = { recaps: true, milestones: true, weeklyHighlights: true };
const guildPage = {
  streamer, guild: { welcome_enabled: 1, welcome_channel_id: '111', welcome_message: 'Hello', sub_sync_enabled: 1, sub_role_id: 'r1' },
  guildName: 'GuildName', guildId: 'g1', channels, roles: [{ id: 'r1', name: 'Subscriber' }], subRoleProblem: null, welcomeMessageMax: 500, deliveryError: null,
  watchedTwitchChannels: [
    { id: 1, twitch_username: 'shroud', live_channel_id: '111', clips_channel_id: '111', is_live: true, profile_image_url: null },
    { id: 2, twitch_username: 'ninja', live_channel_id: null, clips_channel_id: null, is_live: false, profile_image_url: null },
  ],
  watchedYoutubeChannels: [{ id: 1, youtube_channel_id: 'UC1', youtube_channel_name: 'ChannelOne', videos_channel_id: '111', live_channel_id: null, is_live: false, profile_image_url: null }],
  maxTwitchChannels: 25, hasBroadcasterToken: false, broadcasterAuthUrl: 'https://app.test/auth/broadcaster', tier: 'free', limits,
  msg: undefined, saved: undefined, activeTab: 'twitch', features: { youtube: true },
};
const chatbotPage = {
  streamer,
  commands: [{ id: 1, command: 'socials', response: 'Response_text', cooldown: 5, enabled: 1 }, { id: 2, command: 'rules', response: 'Other_text', cooldown: 30, enabled: 0 }],
  botConnected: true, botUsername: 'BotName', bannedWords: [{ id: 1, word: 'badword', is_regex: 0 }, { id: 2, word: 'x+y', is_regex: 1 }], discordChannels: channels, commandError: null,
};
const youtubePage = {
  streamer, commands: [], guilds: [], ytPolling: true, ytLive: true, ytLiveTitle: 'StreamTitle', ytLiveUnknown: false,
  connected: '1', connectedYt: '1', disconnected: '1', error: undefined,
};
const multistreamPage = {
  streamer, multistream: { multistream_enabled: 1, multistream_youtube_privacy: 'unlisted', multistream_youtube_category_id: '22', multistream_youtube_default_title: 'TitleText', multistream_youtube_stream_id: 'abc', multistream_last_error: 'ErrorText', multistream_last_error_at: '2026-10-13T10:00:00Z' },
  ingestUrl: 'rtmp://relay.test/live', streamKey: 'key_123', twitchAuthorized: true, twitchHasStreamKeyScope: true, youtubeConnected: true, youtubeChannelName: 'ChannelName',
  isLive: true, liveUnknown: false, query: { saved: '1', reset: '1', regenerated: '1' },
};
const series = Array.from({ length: 14 }, (_, i) => ({ period: '2026-10-' + String(i + 1).padStart(2, '0'), count: i % 5 }));
const accountPage = {
  streamer: { ...streamer, created_at: '2026-01-02T10:00:00Z', profile_picture: 'a.png' }, tier: 'free', limits: {}, subscription: null, feedbackMsg: 'submitted',
  stats: { total_notifications: 40, notifications_today: 2, notifications_week: 10, notifications_month: 30, total_guilds: 2, total_twitch_channels: 5, total_youtube_channels: 1 },
  notificationsOverTime: series,
  notificationsByType: ['twitch_live', 'twitch_clip', 'twitch_recap', 'youtube_video', 'youtube_live', 'weekly_digest', 'twitch_milestone', 'other_type'].map((type, i) => ({ type, count: i + 1 })),
};
const statsPage = { total: 20, success_count: 18, fail_count: 2, live_count: 5, clip_count: 4, recap_count: 3, milestone_count: 2, youtube_video_count: 3, youtube_live_count: 1, digest_count: 2 };
const PAGE_LOCALS = {
  account: [accountPage, { ...accountPage, streamer: { ...streamer, created_at: null, profile_picture: null, discord_avatar: null }, notificationsOverTime: [], notificationsByType: [], feedbackMsg: undefined }],
  'report-issue': [{ streamer }],
  'link-result': [{ success: true, twitchName: 'TwitchName', streamer: null }, { success: false, twitchName: null, streamer: null }, { success: false, expired: true, linkMinutes: 15, twitchName: null, streamer: null }],
  tutorial: [{ streamer: null }],
  donate: [{ streamer }],
  'streamer-landing': [{ streamer: null }],
  login: [{ streamer: null }],
  'guild-stats': [
    { streamer, guild: {}, guildName: 'GuildName', guildId: 'g1', period: '7d', stats: statsPage, chartData: series, twitchCount: 1, youtubeCount: 2 },
    { streamer, guild: {}, guildName: 'GuildName', guildId: 'g1', period: 'lifetime', stats: statsPage, chartData: [], twitchCount: 0, youtubeCount: 1 },
  ],
  'guild-config': [
    guildPage,
    { ...guildPage, msg: 'channel_limit', limits: { recaps: false, milestones: false, weeklyHighlights: false }, hasBroadcasterToken: true, features: { youtube: false }, watchedTwitchChannels: [], watchedYoutubeChannels: [],
      deliveryError: { channel: '#general', when: '2026-10-13 UTC', unavailable: false, error: 'Boom' }, subRoleProblem: 'missing' },
  ],
  'overlay-config': [
    { streamer, hasStreamElementsJwt: true, giveawayDurationSeconds: 8, overlayUrl: 'https://app.test/overlay/tok123', needsReauth: true, appUrl: 'https://app.test', features: { youtube: true } },
    { streamer, hasStreamElementsJwt: false, giveawayDurationSeconds: 8, overlayUrl: null, needsReauth: false, appUrl: 'https://app.test', features: { youtube: false } },
  ],
  'overlay-builder': [
    { streamer, designs: '[]', sponsors: JSON.stringify([{ id: 1, filename: 'a.png', display_name: 'SponsorName', display_duration: 30, enabled: 1, image_scale: 1 }]),
      eventDefaults: JSON.stringify(EVENT_DEFAULTS), overlayUrl: 'https://app.test/overlay/tok123', streamThumbnail: 'https://img.test/t.jpg', features: { youtube: true } },
    { streamer, designs: '[]', sponsors: '[]', eventDefaults: JSON.stringify(EVENT_DEFAULTS), overlayUrl: null, streamThumbnail: null, features: { youtube: false } },
  ],
  'chatbot-config': [
    chatbotPage,
    { ...chatbotPage, botConnected: false, commands: [], bannedWords: [], commandError: 'ErrorText' },
    { ...chatbotPage, botConnected: false, botUsername: '', streamer: { ...streamer, twitch_username: null } },
    { ...chatbotPage, botConnected: false },
  ],
  'mod-log': [
    { streamer, modLog: [] },
    { streamer, modLog: ['warn', 'delete', 'timeout_10', 'timeout_60', 'timeout_600', 'timeout_1800', 'other'].map((action, i) => ({ created_at: '2026-10-13 10:0' + i + ':00', username: 'user' + i, action, reason: i % 2 ? null : 'reason' })) },
  ],
  'youtube-chatbot-config': [
    youtubePage,
    { ...youtubePage, ytPolling: false, ytLive: false, connected: undefined, connectedYt: undefined, disconnected: undefined, error: 'ErrorText' },
    { ...youtubePage, ytPolling: false, ytLive: false, ytLiveUnknown: true, guilds: [{ guild_id: 'g1' }] },
    { ...youtubePage, ytPolling: false, ytLive: false, streamer: { ...streamer, yt_access_token: null, yt_channel_name: null } },
  ],
  multistream: [
    multistreamPage,
    { ...multistreamPage, isLive: false, liveUnknown: true, twitchHasStreamKeyScope: false, youtubeConnected: false, query: { error: 'live' }, multistream: { multistream_enabled: 0 } },
    { ...multistreamPage, isLive: false, twitchAuthorized: false, query: { error: 'relay' }, multistream: { multistream_enabled: 0 } },
  ],
};

// t() that marks everything it returns, so whatever is not marked in the rendered page is the page's own.
// It also refuses a key that does not exist and a call that leaves a {{field}} of the text unfilled (t() would print nothing for it).
const marked = (key, params) => {
  assert.ok(key in en, `t('${key}') asks for a key that en.json does not have`);
  const missing = [...en[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((name) => !params || !(name in params));
  assert.deepEqual(missing, [], `t('${key}') is called without ${missing.join(', ')}`);
  return '«' + t('en', key, params) + '»';
};
function render(page, locals) {
  return ejs.render(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8'), {
    racingUser: null, isAdmin: false, features: { youtube: false }, lang: 'en', csrfToken: 'token', currentPath: '/x', notifications: [], unreadNotifCount: 0, streamerTier: 'free',
    SUPPORTED_LANGS: ['en'], t: marked, ...locals,
  }, { filename: path.join(VIEWS, page + '.ejs'), views: [VIEWS] });
}
// The page's own part: a header page starts at the container the shared header opens (its sidebar is not the page's).
function pageBody(html) {
  const at = html.indexOf('<div class="container">');
  return at >= 0 ? html.slice(at) : html;
}
// Removes every « … » (a message may hold markup and other messages), innermost first.
function withoutMarked(html) {
  let out = html;
  for (let guard = 0; guard < 10 && /«[^«»]*»/.test(out); guard++) out = out.replace(/«[^«»]*»/g, ' ');
  return out;
}
const stripBlocks = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

describe('the rendered page has no text of its own', () => {
  for (const page of PAGES) {
    test(page, () => {
      const found = new Set();
      for (const locals of PAGE_LOCALS[page]) {
        const rendered = render(page, locals);
        const html = withoutMarked(stripBlocks(pageBody(rendered)));
        // text between tags that is outside « »; a time or a date is data
        for (const m of html.matchAll(/>([^<>]+)</g)) {
          if (/\d{1,2}[:/]\d{2}/.test(m[1])) continue;
          if (strayWords(m[1], page).some((w) => !isStubData(w))) found.add(m[1].replace(/\s+/g, ' ').trim().slice(0, 80));
        }
        for (const m of html.matchAll(/\s(placeholder|title|alt|aria-label|label)="([^"]*)"/g)) {
          if (strayWords(m[2], page).some((w) => !isStubData(w))) found.add(`${m[1]}="${m[2].slice(0, 60)}"`);
        }
        // the page's <title> is wording too (it may hold a name next to the wording)
        const title = withoutMarked(rendered).match(/<title>([^<]*)<\/title>/);
        if (title && strayWords(title[1], page).some((w) => !isStubData(w))) found.add(`<title>${title[1]}`);
      }
      assert.deepEqual([...found], [], `${page} renders text that does not come from t():\n  ${[...found].join('\n  ')}`);
    });
  }
});
// Words the stubs above put into the pages as data (names, values) that the pages show as they are.
const STUB_DATA = new Set(['FREE', 'free', 'tester', 'Tester', 'tester_tv', 'Tester_TV', 'GuildName', 'shroud', 'ninja', 'ChannelOne', 'ChannelName', 'StreamTitle', 'TitleText',
  'ErrorText', 'SponsorName', 'BotName', 'badword', 'socials', 'rules', 'general', 'Subscriber', 'Hello', 'reason', 'other', 'username', 'tok123']);
const isStubData = (word) => STUB_DATA.has(word) || /^(?:user|key)\d*$/.test(word);

// ── 3. The texts handed to the scripts ───────────────────────────────────

describe('the texts a page hands its script are all there', () => {
  for (const page of PAGES) {
    const hasScriptTexts = fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8').includes('I18N = ');
    test(page + (hasScriptTexts ? '' : ' (no script texts)'), () => {
      for (const locals of PAGE_LOCALS[page]) {
        const html = render(page, locals);
        const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
        for (const script of scripts) assert.doesNotThrow(() => new Function(script), `${page}: an inline script does not parse`);
        const all = scripts.join('\n');
        const declared = all.match(/(?:const|var|let) I18N = (\{.*\});/);
        const used = [...new Set([...all.matchAll(/\bI18N\.(\w+)/g)].map((m) => m[1]))];
        if (!used.length) { assert.equal(declared, null, `${page}: I18N is declared but never read`); continue; }
        assert.ok(declared, `${page}: the script reads I18N but the server does not render it`);
        const names = Object.keys(JSON.parse(declared[1]));
        assert.deepEqual(used.filter((name) => !names.includes(name)), [], `${page}: the script reads texts the server does not hand over`);
        assert.deepEqual(names.filter((name) => !used.includes(name) && !all.includes(`I18N.${name}`)), [], `${page}: texts handed over but never read`);
      }
    });
  }

  test('nothing in a page (script or inline handler) puts English into an alert, a confirmation or the page itself', () => {
    const offenders = [];
    for (const page of PAGES) {
      const source = fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8');
      for (const call of source.matchAll(/\b(?:alert|confirm)\(\s*(['"`])([^'"`]*[A-Za-z]{3,}[^'"`]*)\1/g)) offenders.push(`${page}: ${call[0].slice(0, 70)}`);
      // markup ('<svg ...'), an entity ('&times;') and CSS text ('@keyframes ...') are not wording
      for (const set of source.matchAll(/\.(?:textContent|innerText|innerHTML)\s*=\s*(['"`])(?![<\s@&])([^'"`{]*[A-Za-z]{3,}[^'"`{]*)\1/g)) offenders.push(`${page}: ${set[0].slice(0, 70)}`);
    }
    assert.deepEqual(offenders, []);
  });
});

// ── 4. Texts printed into the page as HTML ───────────────────────────────

describe('texts printed into the page as HTML', () => {
  // <%- t('key', ...) %> and <%- rich('key') %> print the translation as it is (the markup of a link or a bold word
  // is put in through its {{fields}}), so none of these texts may hold a "<" or ">" of its own in any language:
  // it would break the page. Languages that do not have a key yet are skipped.
  const rawKeys = new Set();
  for (const page of PAGES) {
    const source = fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8');
    for (const m of source.matchAll(/<%-\s*(?:t|rich)\(\s*'([A-Za-z0-9_.]+)'/g)) rawKeys.add(m[1]);
  }

  test('the pages print a number of them', () => {
    assert.ok(rawKeys.size >= 35, `found ${rawKeys.size}`);
  });

  for (const lang of ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']) {
    test(lang, () => {
      const locale = require(`../src/locales/${lang}.json`);
      const bad = [...rawKeys].filter((key) => key in locale && /[<>]/.test(locale[key]));
      assert.deepEqual(bad, [], `${lang}.json has markup of its own in texts that are printed as HTML`);
    });
  }
});
