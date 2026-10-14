'use strict';

// The shared layout (views/header.ejs and views/footer.ejs) and the pages built on it:
//   - a page that opens the layout closes it with the footer (the footer closes the container,
//     starts the icons and ends the document);
//   - the team-invite buttons in the notification menu post to routes that exist;
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

describe('the team invite buttons in the notification menu', () => {
  const english = (key, params) => t('en', key, params);
  const render = (notifications) => ejs.render(read(VIEWS, 'header.ejs'), {
    racingUser: { id: 4, username: 'driver', display_name: 'Driver', avatar: null }, streamer: null, isAdmin: false, features: { youtube: true }, lang: 'en',
    csrfToken: 'token', currentPath: '/racing/teams', notifications, unreadNotifCount: notifications.length, streamerTier: 'free', SUPPORTED_LANGS: ['en'],
    t: english, esc, rich: richFor(english), title: 'Teams',
  }, { filename: path.join(VIEWS, 'header.ejs'), views: [VIEWS] });

  const invite = { id: 9, type: 'team_invite', action_type: 'team_invite', action_id: 42, title: 'Team invite', message: 'someone invited you', link: '/racing/teams', is_read: 0, created_at: '2026-10-14 10:00:00' };

  test('accept and decline post to the invite of that notification', () => {
    const actions = [...render([invite]).matchAll(/<form method="POST" action="([^"]*\/invite\/[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(actions, ['/racing/teams/invite/42/accept', '/racing/teams/invite/42/decline']);
  });

  test('and those are routes the server has: the team router is mounted at /racing/teams', () => {
    const mount = read(SRC, 'server.js').match(/app\.use\('(\/racing\/teams)'/);
    assert.ok(mount, 'server.js mounts the team routes');
    const team = read(SRC, 'routes', 'racing-team.js');
    for (const action of ['accept', 'decline']) {
      assert.ok(team.includes(`router.post('/invite/:id/${action}'`), `racing-team.js has POST /invite/:id/${action}`);
    }
    const posted = [...render([invite]).matchAll(/<form method="POST" action="([^"]*\/invite\/[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(posted, ['accept', 'decline'].map((action) => `${mount[1]}/invite/42/${action}`));
  });

  test('a notification that is not an invite has no such buttons', () => {
    const html = render([{ ...invite, type: 'team_join', action_type: null, action_id: null }]);
    assert.ok(!html.includes('/invite/'));
  });
});

describe('the icon library', () => {
  // unpkg serves the file at an exact version for good; its hash is checked by the browser, which
  // refuses the script (and the page loses every icon) if the file is not the one the hash is of.
  const TAG = /<script src="(https:\/\/unpkg\.com\/lucide@(\d+\.\d+\.\d+)\/dist\/umd\/lucide\.min\.js)" integrity="(sha384-[A-Za-z0-9+/]{64})" crossorigin="anonymous"><\/script>/;
  const loaders = views.filter((view) => read(VIEWS, view).includes('lucide.min.js'));

  test('the layout and the pit wall page are the pages that load it', () => {
    assert.deepEqual(loaders, ['header.ejs', 'racing-pitwall.ejs']);
  });

  test('both load one exact version, with its hash, as an anonymous cross-origin script', () => {
    const tags = loaders.map((view) => read(VIEWS, view).match(TAG));
    tags.forEach((tag, i) => assert.ok(tag, `${loaders[i]} loads lucide from an exact version with an integrity hash`));
    assert.equal(tags[0][1], tags[1][1], 'the same URL');
    assert.equal(tags[0][3], tags[1][3], 'the same hash');
  });

  test('no page asks for the latest version of anything from unpkg', () => {
    for (const view of views) assert.ok(!/unpkg\.com\/[^"'\s]*@latest/.test(read(VIEWS, view)), `${view} loads @latest`);
  });
});
