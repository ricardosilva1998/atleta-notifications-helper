'use strict';

// The home page (GET /): the streamer tools' features. The real src/server.js
// app answers over HTTP on 127.0.0.1, on the real src/db.js over an in-memory
// SQLite database, with the real views; the config is a stub and the routers
// server.js mounts from routes/ are empty ones (/, /streamer and /tutorial are
// server.js's own routes). Checks:
//   - a visitor gets "Login with Discord", a logged-in streamer "Open dashboard";
//   - the page names neither Racing (the sidebar's Racing menu and the Racing
//     account's parts of the header are left out) nor the OBS-overlay features;
//   - it renders in the seven languages, with every text filled in;
//   - what it says about YouTube follows the YouTube switch and the API key;
//   - /streamer, the old Streamer landing page, sends people here or to the
//     dashboard, and the other pages keep the sidebar's Racing link.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { t, SUPPORTED_LANGS } = require('./i18n');
const en = require('./locales/en.json');

const SERVER_FILE = path.join(__dirname, 'server.js');
const DB_FILE = path.join(__dirname, 'db.js');
const CONFIG_FILE = path.join(__dirname, 'config.js');

const RealDatabase = require('better-sqlite3');
const realFs = require('fs');
const realExpress = require('express');

const config = {
  adminDiscordIds: [],
  app: { url: 'http://localhost:3000', port: 0 },
  features: { youtube: true },
  youtube: { apiKey: '' },
  multistream: { enabled: false },
  tiers: {},
  csrf: { secret: 'synthetic-csrf-secret' },
  email: {},
};

let app;
let db;
let server;
let port;
const sessions = {};

const logged = [];
const consoleMethods = ['log', 'warn', 'error'];
const realConsole = Object.fromEntries(consoleMethods.map((name) => [name, console[name]]));

before(async () => {
  for (const name of consoleMethods) console[name] = (...args) => logged.push(args.map(String).join(' '));
  // server.js calls express() once: that is the app.
  const express = Object.assign(function expressForTest(...args) { app = realExpress(...args); return app; }, realExpress);
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (parent && parent.filename === SERVER_FILE) {
      if (request === 'express') return express;
      if (request === './routes/multistream') return { dashboardRouter: realExpress.Router(), apiRouter: realExpress.Router() };
      if (request.startsWith('./routes/')) return realExpress.Router();
    }
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch { /* not a file */ }
    if (resolved === CONFIG_FILE) return config;
    return origLoad.apply(this, arguments);
  };
  try {
    require(SERVER_FILE);
    db = require(DB_FILE);
  } finally {
    Module._load = origLoad;
  }

  // A streamer; the same streamer with a linked Racing account (which has a
  // team invite waiting, so the header would show the Racing notification
  // menu); and a Racing account alone.
  const expires = Date.now() + 3600_000;
  const streamer = db.upsertStreamerDiscord('900000000000000001', 'homestreamer', 'Home Streamer', null);
  db.createSession('synthetic-home-streamer', streamer.id, expires);
  const linkedRacer = Number(db.createRacingUser('home-linked-racer', 'x', 'Synthetic Driver', null).lastInsertRowid);
  db.linkRacingUserToStreamer(linkedRacer, streamer.id);
  db.createNotification(linkedRacer, 'team_invite', 'Team invite', 'someone invited you', '/racing/teams', 'team_invite', 42);
  db.createLinkedSession('synthetic-home-linked', streamer.id, linkedRacer, expires);
  const racerAlone = Number(db.createRacingUser('home-racer-alone', 'x', 'Other Driver', null).lastInsertRowid);
  db.createRacingSession('synthetic-home-racer', racerAlone, expires);
  Object.assign(sessions, {
    visitor: null,
    streamer: 'synthetic-home-streamer',
    'streamer with a linked Racing account': 'synthetic-home-linked',
    'Racing account only': 'synthetic-home-racer',
  });

  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  Object.assign(console, realConsole);
});

// A new private address for each request, so no two share a rate-limit counter.
let peers = 0;
const nextPeer = () => { peers++; return `10.1.${Math.floor(peers / 250)}.${(peers % 250) + 1}`; };

function get(urlPath, { session = null, lang = null } = {}) {
  const cookies = [session && `session=${session}`, lang && `lang=${lang}`].filter(Boolean);
  const headers = { 'X-Forwarded-For': nextPeer(), ...(cookies.length ? { Cookie: cookies.join('; ') } : {}) };
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: urlPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end();
  });
}

// ── Reading a page ───────────────────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#34;': '"', '&#39;': "'", '&times;': '×', '&nbsp;': ' ' };
const decode = (text) => text.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);
const withoutCode = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
// What a person can read: the text (the <title> too), the descriptions a link
// preview shows, and the attributes a tooltip or a screen reader reads. Not the
// CSS class names (the layout has a .sidebar-overlay) or the scripts.
function readable(html) {
  const plain = withoutCode(html);
  const parts = [...plain.matchAll(/>([^<]+)</g)].map((m) => m[1]);
  for (const m of plain.matchAll(/\s(?:alt|title|aria-label|placeholder)="([^"]*)"/g)) parts.push(m[1]);
  for (const m of html.matchAll(/<meta\b[^>]*\bcontent="([^"]*)"/g)) parts.push(m[1]);
  return decode(parts.join('\n')).replace(/\s+/g, ' ');
}
// The page's own part: from the container the layout opens (the sidebar and the
// top bar come before it).
const pageBody = (html) => html.slice(html.indexOf('<div class="container">'));
// <a ...> elements: their href and their text.
const textOf = (markup) => decode(markup.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const links = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: (m[1].match(/\bhref="([^"]*)"/) || [])[1],
  text: textOf(m[2]),
}));
// The text of each list item, and of the page's h1 (its markup taken out).
const items = (html) => [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
const headline = (html) => decode((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) || ['', ''])[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
// For each feature card, whether it spans the whole row.
const wideCards = (html) => [...html.matchAll(/<article class="([^"]*\bhome-card\b[^"]*)"/g)].map((m) => /\bhome-card-wide\b/.test(m[1]));
const english = (key, params) => t('en', key, params);

// Words of the hidden features (and of Racing) as each language says them
// (the glossary's terms). OBS, VTuber and "overlay" are the same everywhere.
const HIDDEN_EVERYWHERE = [/overlay/i, /\bOBS\b/i, /vtuber/i, /racing/i];
const HIDDEN_BY_LANGUAGE = {
  en: [/channel points?/i, /tip goals?/i, /sponsor images?/i, /browser sources?/i, /\balerts?\b/i],
  pt: [/pontos do canal/i, /meta de doa/i, /alerta/i],
  es: [/puntos del canal/i, /meta de donaci/i, /alerta/i],
  fr: [/points de chaîne/i, /objectif de dons/i, /alerte/i],
  de: [/kanalpunkte/i, /spendenziel/i, /\balert/i],
  zh: [/叠加层/, /赛车/, /频道积分/, /捐赠目标/, /提醒/],
  ja: [/オーバーレイ/, /レーシング/, /チャンネルポイント/, /寄付目標/, /アラート/],
};

// ── The call to action ───────────────────────────────────────────────────

describe('GET /: the call to action', () => {
  test('a visitor gets "Login with Discord" (to /auth/login) and the Setup Guide, and no dashboard link', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    const body = links(pageBody(res.text));
    const login = body.filter((a) => a.href === '/auth/login');
    assert.ok(login.length >= 1, 'a link to /auth/login');
    for (const a of login) assert.equal(a.text, english('landing.loginDiscord'));
    assert.ok(body.some((a) => a.href === '/tutorial' && a.text === english('nav.setupGuide')), 'a link to the Setup Guide');
    assert.ok(!links(res.text).some((a) => a.href === '/dashboard'), 'no link to the dashboard');
  });

  test('a logged-in streamer gets "Open dashboard" (to /dashboard) instead', async () => {
    for (const session of [sessions.streamer, sessions['streamer with a linked Racing account']]) {
      const res = await get('/', { session });
      assert.equal(res.status, 200);
      const body = links(pageBody(res.text));
      const open = body.filter((a) => a.href === '/dashboard');
      assert.ok(open.length >= 1, 'a link to /dashboard');
      for (const a of open) assert.equal(a.text, english('home.cta.openDashboard'));
      assert.ok(!links(res.text).some((a) => a.href === '/auth/login'), 'no login link');
      assert.ok(body.some((a) => a.href === '/tutorial'), 'the Setup Guide is still offered');
    }
  });

  test('a Racing account alone counts as a visitor here', async () => {
    const res = await get('/', { session: sessions['Racing account only'] });
    assert.ok(links(pageBody(res.text)).some((a) => a.href === '/auth/login'));
  });
});

// ── What the page does not name ──────────────────────────────────────────

describe('GET /: no Racing and no overlay features', () => {
  test('no link to Racing and no word of it, sidebar and top bar included, whoever visits', async () => {
    for (const [who, session] of Object.entries(sessions)) {
      const res = await get('/', { session });
      assert.equal(res.status, 200, who);
      assert.ok(!res.text.includes('/racing'), `${who}: the page links to /racing`);
      assert.doesNotMatch(readable(res.text), /racing/i, `${who}: the page says Racing`);
    }
  });

  test('the sidebar still has the Streamer link: to the dashboard when logged in, here otherwise', async () => {
    const streamerLink = (html) => (html.match(/<a href="([^"]*)" class="sidebar-link">\s*<i data-lucide="tv">/) || [])[1];
    assert.equal(streamerLink((await get('/')).text), '/');
    assert.equal(streamerLink((await get('/', { session: sessions.streamer })).text), '/dashboard');
  });

  for (const lang of SUPPORTED_LANGS) {
    test(`${lang}: none of the hidden features is named`, async () => {
      const text = readable((await get('/', { lang })).text);
      for (const word of [...HIDDEN_EVERYWHERE, ...HIDDEN_BY_LANGUAGE[lang]]) {
        assert.doesNotMatch(text, word, `${lang}: ${word} on the page`);
      }
    });
  }
});

// ── Seven languages ──────────────────────────────────────────────────────

describe('GET /: every language', () => {
  for (const lang of SUPPORTED_LANGS) {
    test(`${lang}: the page is in that language, with every text filled in`, async () => {
      for (const session of [null, sessions.streamer]) {
        const res = await get('/', { lang, session });
        assert.equal(res.status, 200);
        assert.match(res.text, new RegExp(`<html lang="${lang}">`));
        const outsideCode = withoutCode(res.text);
        assert.doesNotMatch(outsideCode, /\{\{\s*\w+\s*\}\}/, 'a {{placeholder}} is left');
        assert.doesNotMatch(outsideCode, /\bundefined\b|\[object Object\]/, 'a value is missing');
        // t() answers a key it cannot find with the key itself
        const text = readable(res.text);
        assert.doesNotMatch(text, /\b(?:home|landing|nav|lang|common)\.[A-Za-z]\w*/, 'a key is printed instead of its text');
        assert.ok(text.includes(t(lang, 'home.pageTitle')), 'the title');
        assert.ok(text.includes(t(lang, 'home.hero.lead')), 'the lead');
        assert.ok(text.includes(t(lang, 'home.how.title')), 'how it works');
        assert.ok(text.includes(t(lang, session ? 'home.cta.openDashboard' : 'landing.loginDiscord')), 'the call to action');
      }
    });
  }

  // t() falls back to English, so a page whose texts are missing in a language would still render: the
  // page's own texts must be that language's. A text may be the English word only where that language's
  // file already says it that way for the same thing (fr and de call giveaways "Giveaways").
  const SAME_THING = { 'home.giveaways.title': 'giveaways.title' };
  test('the page\'s texts are translated: none of them is the English text in another language', () => {
    const own = Object.keys(en).filter((key) => key.startsWith('home.'));
    assert.ok(own.length > 40, 'the page has its texts under home.');
    for (const lang of SUPPORTED_LANGS.filter((code) => code !== 'en')) {
      const locale = require(`./locales/${lang}.json`);
      const untranslated = own.filter((key) => !Object.hasOwn(locale, key)
        || (locale[key] === en[key] && !(SAME_THING[key] && locale[key] === locale[SAME_THING[key]])));
      assert.deepEqual(untranslated, [], `${lang}.json`);
    }
  });

  test('the language buttons: one per language, posting to /set-language, the current one marked', async () => {
    const html = (await get('/', { lang: 'de' })).text;
    const form = html.match(/<form method="POST" action="\/set-language"[\s\S]*?<\/form>/);
    assert.ok(form, 'a language form');
    const buttons = [...form[0].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.deepEqual(buttons.map((b) => (b[1].match(/value="(\w+)"/) || [])[1]), SUPPORTED_LANGS);
    for (const [, attributes, label] of buttons) {
      const value = attributes.match(/value="(\w+)"/)[1];
      assert.match(attributes, /type="submit"/);
      assert.match(attributes, /name="lang"/);
      assert.equal(decode(label.replace(/<[^>]*>/g, '')).trim(), t(value, `lang.${value}`), value);
      assert.equal(/aria-current="true"/.test(attributes), value === 'de', value);
    }
  });
});

// ── What it says about YouTube ───────────────────────────────────────────

describe('GET /: YouTube', () => {
  const restore = { youtube: config.features.youtube, apiKey: config.youtube.apiKey };
  after(() => { config.features.youtube = restore.youtube; config.youtube.apiKey = restore.apiKey; });
  const page = async () => pageBody((await get('/')).text);

  test('with YouTube on and no API key (production today): YouTube videos and the YouTube chatbot, go-live posts for Twitch only', async () => {
    config.features.youtube = true;
    config.youtube.apiKey = '';
    const html = await page();
    const listed = items(html);
    assert.ok(listed.includes(english('home.notify.goLive')));
    assert.ok(!listed.includes(english('home.notify.goLiveYoutube')));
    assert.ok(listed.includes(english('home.notify.clipsYoutube')));
    assert.ok(listed.includes(english('home.youtubeBot.thanks')));
    assert.ok(readable(html).includes(english('home.youtubeBot.title')));
    assert.equal(headline(html), english('home.hero.title', { em: '', emEnd: '' }));
    assert.ok(readable(html).includes(english('home.hero.lead')));
    assert.deepEqual(wideCards(html), [true, false, false, false, false, false, false], 'seven cards: the first wide, the other six two to a row');
  });

  test('with an API key, go-live posts for YouTube too', async () => {
    config.features.youtube = true;
    config.youtube.apiKey = 'synthetic-key';
    const listed = items(await page());
    assert.ok(listed.includes(english('home.notify.goLiveYoutube')));
    assert.ok(!listed.includes(english('home.notify.goLive')));
  });

  test('with YouTube switched off the page does not offer it at all, API key or not', async () => {
    config.features.youtube = false;
    config.youtube.apiKey = 'synthetic-key';
    const html = await page();
    assert.doesNotMatch(readable(html), /youtube|super chat|shorts/i);
    const listed = items(html);
    assert.ok(listed.includes(english('home.notify.goLive')));
    assert.ok(listed.includes(english('home.notify.clips')));
    assert.equal(headline(html), english('home.hero.titleNoYoutube', { em: '', emEnd: '' }));
    assert.ok(readable(html).includes(english('home.hero.leadNoYoutube')));
    assert.deepEqual(wideCards(html), [true, false, false, false, false, true], 'six cards: the last one, alone in its row, is wide too');
  });

  test('with YouTube switched off nothing in the document names it: not the link preview in its head either', async () => {
    config.features.youtube = false;
    const whole = (await get('/')).text;
    assert.doesNotMatch(readable(whole), /youtube|super chat|shorts/i);
    assert.ok(whole.includes(`content="${t('en', 'common.siteDescriptionNoYoutube').replace(/&/g, '&amp;')}"`));
    config.features.youtube = true;
    assert.ok((await get('/')).text.includes(`content="${t('en', 'common.siteDescription').replace(/&/g, '&amp;')}"`), 'switched on, the preview is as it was');
  });

  test('the Setup Guide leaves out its YouTube step and numbers the others on; switched on, it has all eight', async () => {
    const steps = (html) => [...html.matchAll(/<div class="step-number">(\d+)<\/div>/g)].map((m) => Number(m[1]));
    config.features.youtube = false;
    const off = await get('/tutorial');
    assert.equal(off.status, 200);
    assert.doesNotMatch(readable(off.text), /youtube/i);
    assert.deepEqual(steps(off.text), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok(readable(off.text).includes(english('tutorial.step7.title')), 'the welcome step is still there');
    config.features.youtube = true;
    const on = await get('/tutorial');
    assert.deepEqual(steps(on.text), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(readable(on.text).includes(english('tutorial.step6.title')));
  });
});

// ── The page as a document ───────────────────────────────────────────────

describe('GET /: structure', () => {
  test('one h1, and no heading level is skipped', async () => {
    const levels = [...pageBody((await get('/')).text).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((level) => level === 1).length, 1);
    assert.equal(levels[0], 1);
    levels.forEach((level, i) => { if (i) assert.ok(level <= levels[i - 1] + 1, `h${levels[i - 1]} then h${level}`); });
  });

  test('every link and button on the page has text', async () => {
    for (const session of [null, sessions.streamer]) {
      const body = pageBody((await get('/', { session })).text);
      for (const a of links(body)) assert.ok(a.text, `the link to ${a.href} has text`);
      for (const m of body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) assert.ok(m[1].replace(/<[^>]*>/g, '').trim(), 'a button has text');
    }
  });

  test('the icons it asks for are drawn by the layout\'s icon library', async () => {
    const html = (await get('/')).text;
    assert.ok(html.includes('lucide.createIcons()'), 'the footer starts the icons');
    assert.ok(/data-lucide="[a-z-]+"/.test(pageBody(html)), 'the page uses them');
  });
});

// ── /streamer and the other pages ────────────────────────────────────────

describe('GET /streamer, the old Streamer landing page', () => {
  test('a visitor is sent to the home page', async () => {
    const res = await get('/streamer');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
  });

  test('a logged-in streamer is sent to the dashboard', async () => {
    const res = await get('/streamer', { session: sessions.streamer });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard');
  });
});

describe('the other pages keep Racing in the sidebar', () => {
  test('the Setup Guide has the sidebar\'s Racing link, and its Streamer link leads home', async () => {
    const res = await get('/tutorial');
    assert.equal(res.status, 200);
    assert.match(res.text, /<a href="\/racing" class="sidebar-link">/);
    assert.match(res.text, /<a href="\/" class="sidebar-link">\s*<i data-lucide="tv">/);
  });

  test('and so does a page of a logged-in Racing account, with its Racing menu', async () => {
    const res = await get('/tutorial', { session: sessions['streamer with a linked Racing account'] });
    assert.match(res.text, /<a href="\/racing" class="sidebar-link">/);
    assert.match(res.text, /<a href="\/racing\/teams" class="sidebar-link"/);
  });

  test('nothing the pages did was logged as an error', () => {
    assert.deepEqual(logged.filter((line) => /error|failed/i.test(line) && !/\[DB\]/.test(line)), []);
  });
});

test('the keys this test reads are in en.json', () => {
  for (const key of ['landing.loginDiscord', 'nav.setupGuide', 'home.cta.openDashboard', 'home.pageTitle', 'home.hero.title', 'home.hero.titleNoYoutube',
    'home.hero.lead', 'home.hero.leadNoYoutube', 'home.how.title', 'home.notify.goLive', 'home.notify.goLiveYoutube', 'home.notify.clips',
    'home.notify.clipsYoutube', 'home.youtubeBot.title', 'home.youtubeBot.thanks']) {
    assert.ok(Object.hasOwn(en, key), key);
  }
});
