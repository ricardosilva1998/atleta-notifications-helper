'use strict';

// The streamer pages must not carry user-visible English of their own: every text, placeholder,
// tooltip and message goes through t(). Checks:
//   1. the page source has no words outside t() (scripts, styles, comments and EJS tags removed);
//   2. the page, rendered with a t() that wraps what it returns in « », has no word outside the
//      « » (this also catches text next to an EJS value, which the source check can only guess at);
//   3. the texts a page hands its script are all there: every I18N.<name> the script reads is in
//      the object the server renders, and the scripts parse;
//   4. a translation can not add markup to a page (a translator that adds a tag to every text);
//   5. esc() and rich() come from the server (src/i18n.js, set on res.locals next to t()), no view
//      has a copy, and no page links to the legacy pricing and subscription pages;
//   6. what a page builds into the markup of a sentence (a bot's name, a channel name, a link) is
//      printed as text: the stubs use names made of markup, quotes and {{fields}};
//   7. a translated text that a script puts into the page is shown as text.
// What is allowed to stay is listed below with the reason.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { t, esc, richFor, SUPPORTED_LANGS } = require('../src/i18n');
const en = require('../src/locales/en.json');
const { EVENT_DEFAULTS } = require('../src/services/overlayDesign');
const { DEFAULT_DURATION_SECONDS } = require('../src/services/overlaySettings');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const PAGES = [
  'guild-config', 'overlay-config', 'overlay-builder', 'chatbot-config', 'mod-log', 'youtube-chatbot-config', 'multistream',
  'account-disabled', // what a streamer is shown once an admin has disabled the account
  // linked from the site's menus, or the pages a streamer meets before logging in
  'account', 'report-issue', 'tutorial', 'donate', 'streamer-landing', 'login', 'guild-stats', 'link-result',
  // the home page: the streamer tools' features
  'home',
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
  guildName: 'GuildName', guildId: 'g1', channels, roles: [{ id: 'r1', name: 'Subscriber' }], subRoleProblem: null, discordListsUnavailable: false, welcomeMessageMax: 500, deliveryError: null,
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
  // the YouTube step is shown only while YouTube is (features.youtube)
  tutorial: [{ streamer: null, features: { youtube: true } }, { streamer: null, features: { youtube: false } }],
  donate: [{ streamer }],
  'streamer-landing': [{ streamer: null }],
  login: [{ streamer: null }],
  // a visitor, a streamer (YouTube go-live posts on), and YouTube switched off
  home: [
    { streamer: null, racingUser: null, hideRacingNav: true, youtubeLive: false, features: { youtube: true } },
    { streamer, racingUser: null, hideRacingNav: true, youtubeLive: true, features: { youtube: true } },
    { streamer: null, racingUser: null, hideRacingNav: true, youtubeLive: false, features: { youtube: false } },
  ],
  'guild-stats': [
    { streamer, guild: {}, guildName: 'GuildName', guildId: 'g1', period: '7d', stats: statsPage, chartData: series, twitchCount: 1, youtubeCount: 2, features: { youtube: true } },
    { streamer, guild: {}, guildName: 'GuildName', guildId: 'g1', period: 'lifetime', stats: statsPage, chartData: [], twitchCount: 0, youtubeCount: 1, features: { youtube: true } },
    { streamer, guild: {}, guildName: 'GuildName', guildId: 'g1', period: '30d', stats: statsPage, chartData: series, twitchCount: 1, youtubeCount: 2, features: { youtube: false } },
  ],
  'guild-config': [
    guildPage,
    { ...guildPage, msg: 'channel_limit', limits: { recaps: false, milestones: false, weeklyHighlights: false }, hasBroadcasterToken: true, features: { youtube: false }, watchedTwitchChannels: [], watchedYoutubeChannels: [],
      deliveryError: { channel: '#general', when: '2026-10-13 UTC', unavailable: false, error: 'Boom' }, subRoleProblem: 'missing' },
    // the bot cannot see the server: no lists, a notice, and the pickers show what is saved
    { ...guildPage, discordListsUnavailable: true, channels: [], roles: [] },
  ],
  'overlay-config': [
    { streamer, hasStreamElementsJwt: true, giveawayDurationSeconds: 8, durationDefaults: DEFAULT_DURATION_SECONDS, overlayUrl: 'https://app.test/overlay/tok123', needsReauth: true, appUrl: 'https://app.test', features: { youtube: true, kick: true } },
    { streamer, hasStreamElementsJwt: false, giveawayDurationSeconds: 8, durationDefaults: DEFAULT_DURATION_SECONDS, overlayUrl: null, needsReauth: false, appUrl: 'https://app.test', features: { youtube: false } },
  ],
  'overlay-builder': [
    { streamer, designs: '[]', sponsors: JSON.stringify([{ id: 1, filename: 'a.png', display_name: 'SponsorName', display_duration: 30, enabled: 1, image_scale: 1 }]),
      eventDefaults: JSON.stringify(EVENT_DEFAULTS), overlayUrl: 'https://app.test/overlay/tok123', streamThumbnail: 'https://img.test/t.jpg', features: { youtube: true, kick: true } },
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
PAGE_LOCALS['account-disabled'] = [{ streamer: null }];
// The account page shows YouTube's channels and posts only while YouTube is (features.youtube): each sample both ways.
PAGE_LOCALS.account = PAGE_LOCALS.account.flatMap((locals) => [true, false].map((youtube) => ({ ...locals, features: { youtube } })));
// These pages show less while the overlay features are off (features.overlays, off by default): each of their samples is rendered both ways.
for (const page of ['youtube-chatbot-config', 'account-disabled']) {
  PAGE_LOCALS[page] = PAGE_LOCALS[page].flatMap((locals) => [true, false].map((overlays) => ({ ...locals, features: { youtube: true, overlays } })));
}

// t() that marks everything it returns, so whatever is not marked in the rendered page is the page's own.
// It also refuses a key that does not exist and a call that leaves a {{field}} of the text unfilled (t() would print nothing for it).
const marked = (key, params) => {
  assert.ok(key in en, `t('${key}') asks for a key that en.json does not have`);
  const missing = [...en[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((name) => !params || !(name in params));
  assert.deepEqual(missing, [], `t('${key}') is called without ${missing.join(', ')}`);
  return '«' + t('en', key, params) + '»';
};
// What server.js puts on res.locals: t(), and esc() and rich() (from src/i18n.js) with rich() built on that t().
function render(page, locals, translate = marked) {
  return ejs.render(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8'), {
    racingUser: null, isAdmin: false, features: { youtube: false }, lang: 'en', csrfToken: 'token', currentPath: '/x', notifications: [], unreadNotifCount: 0, streamerTier: 'free',
    SUPPORTED_LANGS: ['en'], t: translate, esc, rich: richFor(translate), ...locals,
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

describe('the overlay builder\'s sponsor name and font sample are texts of the page', () => {
  const source = fs.readFileSync(path.join(VIEWS, 'overlay-builder.ejs'), 'utf8');

  test('the page source holds neither the default sponsor name nor the sample sentence', () => {
    assert.ok(!/'Sponsor'/.test(source), "no 'Sponsor' fallback typed into the script");
    assert.ok(!/value="Sponsor"/.test(source), 'no default name typed into the upload field');
    assert.ok(!source.includes('The quick brown fox'), 'no sample sentence typed into the font gallery');
  });

  for (const lang of SUPPORTED_LANGS) {
    test(`${lang}: the upload field starts with the sponsor name of that language, and the script gets it and the sample`, () => {
      const translate = (key, params) => t(lang, key, params);
      const html = render('overlay-builder', PAGE_LOCALS['overlay-builder'][0], translate);
      const name = t(lang, 'overlayBuilder.sponsors.defaultName');
      assert.ok(html.includes(`id="sp-upload-name" class="sp-upload-input" placeholder="${esc(t(lang, 'overlayBuilder.sponsors.namePlaceholder'))}" value="${esc(name)}"`));
      const texts = JSON.parse(html.match(/const I18N = (\{.*\});/)[1]);
      assert.equal(texts.defaultSponsorName, name);
      assert.equal(texts.fontSample, t(lang, 'overlayBuilder.text.fontSample'));
    });
  }
});

describe('every page renders in every language, with nothing left unfilled, and its scripts parse', () => {
  for (const page of PAGES) {
    test(page, () => {
      for (const lang of SUPPORTED_LANGS) {
        const translate = (key, params) => t(lang, key, params);
        for (const locals of PAGE_LOCALS[page]) {
          const html = render(page, { lang, ...locals }, translate);
          assert.ok(!/\{\{\w+\}\}/.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), `${page} (${lang}): a {{field}} was left in the page`);
          assert.ok(!/>\s*undefined\s*</.test(html) && !/="undefined"/.test(html), `${page} (${lang}): "undefined" is printed`);
          for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
            assert.doesNotThrow(() => new Function(m[1]), `${page} (${lang}): an inline script does not parse`);
          }
        }
      }
    });
  }
});

// ── The overlay features switched off (features.overlays) ────────────────

describe('while the overlay features are off, the YouTube chatbot and the disabled-account pages say nothing about the overlays', () => {
  // The wording that says a text is about the overlays; the layout's own site description (the link preview in header.ejs) is not the page's.
  const ABOUT_OVERLAYS = /overlay|\bOBS\b|browser source|vtuber|channel point/i;
  const samples = (page, overlays) => PAGE_LOCALS[page].filter((locals) => locals.features.overlays === overlays);
  const keysAsked = (page, locals) => {
    const keys = new Set();
    render(page, locals, (key, params) => { keys.add(key); return t('en', key, params); });
    return keys;
  };

  for (const page of ['youtube-chatbot-config', 'account-disabled']) {
    test(`${page}: asks for no text about them`, () => {
      assert.ok(samples(page, false).length > 0);
      for (const locals of samples(page, false)) {
        const about = [...keysAsked(page, locals)].filter((key) => key !== 'common.siteDescription' && ABOUT_OVERLAYS.test(en[key]));
        assert.deepEqual(about, [], `${page} asks for texts about the overlays`);
      }
    });
  }

  test('the YouTube chatbot page has none of the overlay switches, test buttons or script', () => {
    for (const locals of samples('youtube-chatbot-config', false)) {
      const html = render('youtube-chatbot-config', locals, (key, params) => t('en', key, params));
      assert.ok(!/yt_overlay_|testEvent|youtube-chatbot\/test\/|overlayChatSent|overlaySent/.test(html), 'an overlay switch, button or text is on the page');
      assert.ok(/testChatOnly/.test(html) && /name="yt_chat_superchat_template"/.test(html), 'the chat settings and tests are');
    }
  });

  test('switched on, they ask for the texts about them again', () => {
    const wanted = {
      'youtube-chatbot-config': ['ytChatbot.events', 'ytChatbot.eventsHint', 'ytChatbot.showOverlay', 'ytChatbot.testOverlay', 'ytChatbot.js.overlaySent'],
      'account-disabled': ['account.disabled.body'],
    };
    for (const [page, keys] of Object.entries(wanted)) {
      const asked = new Set();
      for (const locals of samples(page, true)) for (const key of keysAsked(page, locals)) asked.add(key);
      assert.deepEqual(keys.filter((key) => !asked.has(key)), [], `${page} no longer asks for a text it asked for before`);
    }
  });
});

// ── YouTube and Kick switched off (features.youtube, features.kick) ──────

describe('while YouTube and Kick are switched off, the streamer pages say nothing about them', () => {
  // What a person reads: the text and the attributes a tooltip or a screen reader reads (scripts and styles left out:
  // an overlay script names its YouTube alert types in code).
  const readable = (html) => {
    const plain = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    return [...plain.matchAll(/>([^<]+)</g)].map((m) => m[1]).concat([...plain.matchAll(/\s(?:alt|title|aria-label|placeholder|content)="([^"]*)"/g)].map((m) => m[1])).join('\n');
  };
  const keysAsked = (page, locals) => {
    const keys = new Set();
    render(page, locals, (key, params) => { keys.add(key); return t('en', key, params); });
    return keys;
  };
  const CASES = {
    youtube: { about: /youtube|super ?chats?|\bshorts\b/i, pages: ['guild-config', 'account', 'tutorial', 'guild-stats', 'home', 'overlay-config', 'overlay-builder'] },
    kick: { about: /\bkick\b/i, pages: ['overlay-config', 'overlay-builder'] },
  };
  // The Overlay Builder's script keeps a name for every alert type (it is data: without the YouTube tabs no YouTube
  // alert can be picked), so for that page only what it shows is checked.
  const SCRIPT_KEEPS_NAMES = new Set(['overlay-builder']);
  for (const [flag, { about, pages }] of Object.entries(CASES)) {
    for (const page of pages) {
      test(`${flag} off: ${page} asks for no text about it and shows none; on, it does again`, () => {
        const off = PAGE_LOCALS[page].filter((locals) => !(locals.features || {})[flag]);
        const on = PAGE_LOCALS[page].filter((locals) => (locals.features || {})[flag]);
        assert.ok(off.length > 0 && on.length > 0, `${page} has samples with ${flag} on and off`);
        for (const locals of off) {
          if (!SCRIPT_KEEPS_NAMES.has(page)) assert.deepEqual([...keysAsked(page, locals)].filter((key) => about.test(en[key])), [], `${page} asks for texts about ${flag}`);
          const shown = readable(render(page, locals, (key, params) => t('en', key, params))).match(about);
          assert.ok(!shown, `${page} shows ${shown && shown[0]}`);
        }
        const again = on.some((locals) => readable(render(page, locals, (key, params) => t('en', key, params))).match(about));
        assert.ok(again, `${page} talks about ${flag} again while it is on`);
      });
    }
  }

  test('the Setup Guide numbers its steps on without the YouTube one', () => {
    const steps = (locals) => [...render('tutorial', locals, (key, params) => t('en', key, params)).matchAll(/<div class="step-number">(\d+)<\/div>/g)].map((m) => Number(m[1]));
    assert.deepEqual(steps(PAGE_LOCALS.tutorial[0]), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(steps(PAGE_LOCALS.tutorial[1]), [1, 2, 3, 4, 5, 6, 7]);
  });
});

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

// ── 4. A translation can not add markup ─────────────────────────────────

describe('a translation can not add markup to a page', () => {
  // Texts from the language files are printed escaped everywhere. The links, bold words and code of a sentence are built by the
  // page and put in through the {{fields}} of the text (rich(), from src/i18n.js, escapes the text first), so whatever a language
  // file holds stays text.
  const evil = (key, params) => t('en', key, params) + '<img src=x onerror=alert(1)>';

  for (const page of PAGES) {
    test(page, () => {
      for (const locals of PAGE_LOCALS[page]) {
        const html = render(page, locals, evil);
        assert.ok(!html.includes('<img src=x onerror'), `${page}: a translation was printed as markup`);
      }
    });
  }

  test('no view prints t() unescaped', () => {
    const offenders = PAGES.filter((page) => /<%-\s*t\(/.test(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8')));
    assert.deepEqual(offenders, []);
  });
});

// ── 5. esc() and rich() come from the server ─────────────────────────────

// Strings in a piece of EJS become S, so what is left is its structure.
const stripStrings = (code) => code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, 'S');
// Every <%- rich( ... ) %> in a page, with its arguments as written.
const richCalls = (source) => [...source.matchAll(/<%-\s*rich\(([\s\S]*?)\)\s*%>/g)].map((m) => m[1]);
// The data a page builds into the markup of its sentences: each esc( ... ) inside a rich() call.
const escSites = (source) => richCalls(source).reduce((sum, args) => sum + (stripStrings(args).match(/\besc\(/g) || []).length, 0);

describe('esc() and rich() come from the server, and are used the same way everywhere', () => {
  test('no view defines its own copy (server.js puts them on res.locals next to t())', () => {
    const offenders = [];
    for (const file of fs.readdirSync(VIEWS).filter((name) => name.endsWith('.ejs'))) {
      // only the EJS tags: the page scripts may have functions of their own with these names
      for (const tag of fs.readFileSync(path.join(VIEWS, file), 'utf8').match(/<%[\s\S]*?%>/g) || []) {
        if (/\b(?:const|let|var|function)\s+(?:esc|rich)\b/.test(tag)) offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('every rich() call names the markup it fills in', () => {
    const offenders = [];
    for (const page of PAGES) {
      for (const args of richCalls(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8'))) {
        if (!stripStrings(args).includes(',')) offenders.push(`${page}: rich(${args.slice(0, 50)})`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('whatever a rich() call builds into its markup besides fixed text is wrapped in esc()', () => {
    const offenders = [];
    for (const page of PAGES) {
      for (const args of richCalls(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8'))) {
        // fixed text -> S, esc( ... ) -> E; around every "+" there must be one of the two
        let shape = stripStrings(args);
        for (let i = 0; i < 3; i++) shape = shape.replace(/\besc\((?:[^()]|\([^()]*\))*\)/g, 'E');
        const pieces = shape.split('+');
        const last = (piece) => piece.trim().split(/[\s,:{}]+/).pop();
        const first = (piece) => piece.trim().split(/[\s,:{}]+/)[0];
        pieces.forEach((piece, i) => {
          if (i < pieces.length - 1 && !['S', 'E'].includes(last(piece))) offenders.push(`${page}: ${last(piece)} + ... in rich(${args.slice(0, 60)})`);
          if (i > 0 && !['S', 'E'].includes(first(piece))) offenders.push(`${page}: ... + ${first(piece)} in rich(${args.slice(0, 60)})`);
        });
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe('the pages lead nowhere into the legacy pricing and subscription pages', () => {
  // Everything on the site is free. /pricing and /payment/subscription are leftovers that only speak English;
  // no page of the streamer's may link to them.
  const LEGACY = /(?:href|action)\s*=\s*["']\/(?:pricing|payment)\b/;

  for (const page of PAGES) {
    test(page, () => {
      assert.ok(!LEGACY.test(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8')), `${page}.ejs links to a legacy page`);
      for (const locals of PAGE_LOCALS[page]) assert.ok(!LEGACY.test(render(page, locals)), `${page} renders a link to a legacy page`);
    });
  }
});

// ── 6. Data inside the markup a page builds ──────────────────────────────

describe('data a page builds into the markup of a sentence is printed as text', () => {
  // A sentence with a link or a bold word is built by the page: <%- rich(key, { name: '<strong>' + esc(value) + '</strong>' }) %>.
  // The value is a bot's name, a channel name, a display name or an authorize URL, so it is not the page's own. The stubs above use
  // plain names; these use a value that is nothing but trouble (a tag, quotes of both kinds, {{fields}}, dollar patterns) and
  // expect it in the page exactly as esc() prints it: once, whole, and as nothing else.
  const TAG = '<img src=x onerror=alert(1)>';
  const NAME = `${TAG} "double" 'single' {{b}} {{aEnd}} $& $1 </strong></a>`;
  const URL_VALUE = `https://app.test/auth/broadcaster?a=1&b="onfocus="alert(1)'>${TAG}`;
  const occurrences = (html, needle) => html.split(needle).length - 1;
  const english = (key, params) => t('en', key, params);

  // sites: how many places in the page print the value through rich(); around: what must surround it (an attribute value)
  const CASES = [
    { page: 'chatbot-config', what: 'the bot\'s name, connected', locals: { ...PAGE_LOCALS['chatbot-config'][0], botUsername: NAME }, value: NAME, sites: 1 },
    { page: 'chatbot-config', what: 'the bot\'s name, not connected', locals: { ...PAGE_LOCALS['chatbot-config'][0], botConnected: false, botUsername: NAME }, value: NAME, sites: 1 },
    { page: 'link-result', what: 'the Twitch name', locals: { success: true, twitchName: NAME, streamer: null }, value: NAME, sites: 1 },
    { page: 'youtube-chatbot-config', what: 'the YouTube channel name', locals: { ...PAGE_LOCALS['youtube-chatbot-config'][0], streamer: { ...streamer, yt_channel_name: NAME } }, value: NAME, sites: 1 },
    { page: 'multistream', what: 'the Twitch display name and the YouTube channel name', locals: { ...PAGE_LOCALS.multistream[0], streamer: { ...streamer, twitch_display_name: NAME }, youtubeChannelName: NAME }, value: NAME, sites: 2 },
    { page: 'guild-config', what: 'the broadcaster authorize link, twice', locals: { ...PAGE_LOCALS['guild-config'][0], hasBroadcasterToken: false, broadcasterAuthUrl: URL_VALUE }, value: URL_VALUE, sites: 2, around: ['href="', '"'] },
    { page: 'guild-stats', what: 'the two channel counts', locals: { ...PAGE_LOCALS['guild-stats'][0], twitchCount: NAME, youtubeCount: NAME }, value: NAME, sites: 2 },
  ];

  for (const { page, what, locals, value, sites, around = ['', ''] } of CASES) {
    test(`${page}: ${what}`, () => {
      const html = render(page, locals, english);
      assert.ok(!html.includes(TAG), `${page} printed the value's own markup`);
      const printed = around[0] + esc(value) + around[1];
      assert.equal(occurrences(html, printed), sites, `${page} should print the value ${sites} time(s), escaped once, as ${printed.slice(0, 60)}...`);
    });
  }

  test('the cases cover every place a page builds data into a rich() sentence', () => {
    for (const page of PAGES) {
      const places = escSites(fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8'));
      const covered = CASES.filter((c) => c.page === page).reduce((sum, c) => sum + c.sites, 0);
      assert.equal(covered, places, `${page}.ejs builds data into ${places} rich() place(s); the cases above cover ${covered}`);
    }
  });
});

// ── 7. A translated text that a script puts into the page ────────────────

describe('a translated text that a script puts into the page is shown as text', () => {
  const TAG = '<img src=x onerror=alert(1)>';
  const english = (key, params) => t('en', key, params);

  test('no script writes HTML that holds a translation unless it escapes it first', () => {
    // A line that sets innerHTML (or the like) with an I18N text in it: esc(I18N.x), or I18N.x.replace(/</g, ...) for the "<"
    // that opens markup. Anything else sets textContent.
    const offenders = [];
    for (const page of PAGES) {
      fs.readFileSync(path.join(VIEWS, page + '.ejs'), 'utf8').split('\n').forEach((line, i) => {
        if (!/\b(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\(/.test(line) || !/\bI18N\.\w+/.test(line)) return;
        const texts = [...line.matchAll(/\bI18N\.\w+(?:\.\w+(?:\([^)]*\))?)*/g)].map((m) => m[0]);
        const bare = texts.filter((text) => !line.includes(`esc(${text})`) && !/\.replace\(\/</.test(text));
        if (bare.length) offenders.push(`${page}.ejs line ${i + 1}: ${bare.join(', ')} goes into HTML as it is`);
      });
    }
    assert.deepEqual(offenders, []);
  });

  // The function with the given name in a page script, cut out by its braces.
  function scriptFunction(script, name) {
    const start = script.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} is in the page script`);
    const open = script.indexOf('{', script.indexOf(')', start));
    let depth = 0;
    for (let i = open; i < script.length; i++) {
      if (script[i] === '{') depth++;
      else if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
    }
    throw new Error(`${name} does not end`);
  }
  // A button that records how its content was set: as markup (innerHTML) or as text (textContent).
  function fakeButton(markup) {
    let html = markup;
    const writes = [];
    return {
      writes,
      disabled: false,
      get innerHTML() { return html; },
      set innerHTML(value) { writes.push(['markup', value]); html = value; },
      set textContent(value) { writes.push(['text', value]); html = esc(value); },
    };
  }

  // The chatbot page's test buttons show "Sending...", then how it went, and put their own markup (an icon) back after a moment.
  describe('the chatbot page\'s test buttons', () => {
    const ICON_BUTTON = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg> Test';
    // every text of the script is made of the tag, so any that reaches the page as markup shows
    const hostile = (key, params) => (key.startsWith('chatbot.js.') ? `${TAG} ${key}` : english(key, params));
    const html = render('chatbot-config', PAGE_LOCALS['chatbot-config'][0], hostile);
    const script = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).find((s) => s.includes('async function testChat('));
    const I18N = JSON.parse(script.match(/(?:const|var|let) I18N = (\{.*\});/)[1]);

    const outcomes = [
      ['it worked', async () => ({ json: async () => ({ ok: true }) }), 'sent'],
      ['the server said no', async () => ({ json: async () => ({ ok: false, error: 'No' }) }), 'failed'],
      ['the request failed', async () => { throw new Error('offline'); }, 'error'],
    ];
    for (const [fn, args] of [['testChat', ['follow']], ['testCustomCommand', ['Hello']]]) {
      for (const [label, fetchStub, status] of outcomes) {
        test(`${fn}: ${label}`, async () => {
          const run = new Function('I18N', 'fetch', 'setTimeout', 'alert', 'encodeURIComponent', `${scriptFunction(script, fn)}\nreturn ${fn};`);
          const timers = [];
          const button = fakeButton(ICON_BUTTON);
          await run(I18N, fetchStub, (callback) => timers.push(callback), () => {}, encodeURIComponent)(...args, button);

          assert.deepEqual(button.writes, [['text', I18N.sending], ['text', I18N[status]]], 'both statuses were set as text');
          assert.ok(button.writes.every(([how, value]) => how === 'text' || !value.includes(TAG)), 'no status was set as markup');
          assert.equal(button.disabled, true, 'the button waits while the status shows');
          timers.forEach((callback) => callback());
          assert.equal(button.innerHTML, ICON_BUTTON, 'the button\'s own markup, icon included, comes back');
          assert.equal(button.disabled, false);
        });
      }
    }
  });
});
