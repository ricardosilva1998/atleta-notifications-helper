'use strict';

// The shared layout (views/header.ejs and views/footer.ejs) and the pages built on it:
//   - a page that opens the layout closes it with the footer (the footer closes the container,
//     starts the icons and ends the document);
//   - the layout renders without any Racing locals;
//   - the icon library is loaded from one exact version, checked by its hash.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { t, esc, richFor } = require('../src/i18n');

const SRC = path.join(__dirname, '..', 'src');
const VIEWS = path.join(SRC, 'views');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const views = fs.readdirSync(VIEWS).filter((name) => name.endsWith('.ejs')).sort();

describe('every page that opens the layout closes it', () => {
  for (const name of views.filter((view) => /include\(\s*'header'/.test(read(VIEWS, view)))) {
    test(name, () => {
      assert.match(read(VIEWS, name), /<%-\s*include\(\s*'footer'\s*\)\s*%>/, `${name} includes the header but not the footer`);
    });
  }
});

describe('the layout without Racing', () => {
  const english = (key, params) => t('en', key, params);
  const render = (locals) => ejs.render(read(VIEWS, 'header.ejs'), {
    streamer: null, isAdmin: false, features: { youtube: true }, lang: 'en',
    csrfToken: 'token', currentPath: '/', streamerTier: 'free', SUPPORTED_LANGS: ['en'],
    t: english, esc, rich: richFor(english), title: 'Home', ...locals,
  }, { filename: path.join(VIEWS, 'header.ejs'), views: [VIEWS] });

  test('renders for a visitor without any Racing, notification or nav locals', () => {
    const html = render({});
    assert.ok(!/racing|\/tracks|notif-dropdown/i.test(html.replace(/<style[\s\S]*?<\/style>/g, '')));
    assert.ok(!html.includes('action="/auth/logout"'));
  });

  test('a streamer gets the logout form and the account link', () => {
    const html = render({ streamer: { id: 1, discord_username: 'viewer', discord_display_name: 'Viewer', discord_avatar: null, profile_picture: null } });
    assert.ok(html.includes('action="/auth/logout"'));
    assert.ok(html.includes('href="/dashboard/account"'));
  });
});

describe('the icon library', () => {
  // unpkg serves the file at an exact version for good; its hash is checked by the browser, which
  // refuses the script (and the page loses every icon) if the file is not the one the hash is of.
  const TAG = /<script src="(https:\/\/unpkg\.com\/lucide@(\d+\.\d+\.\d+)\/dist\/umd\/lucide\.min\.js)" integrity="(sha384-[A-Za-z0-9+/]{64})" crossorigin="anonymous"><\/script>/;
  const loaders = views.filter((view) => read(VIEWS, view).includes('lucide.min.js'));

  test('the layout is the only page that loads it', () => {
    assert.deepEqual(loaders, ['header.ejs']);
  });

  test('it loads one exact version, with its hash, as an anonymous cross-origin script', () => {
    const tags = loaders.map((view) => read(VIEWS, view).match(TAG));
    tags.forEach((tag, i) => assert.ok(tag, `${loaders[i]} loads lucide from an exact version with an integrity hash`));
  });

  test('no page asks for the latest version of anything from unpkg', () => {
    for (const view of views) assert.ok(!/unpkg\.com\/[^"'\s]*@latest/.test(read(VIEWS, view)), `${view} loads @latest`);
  });
});
