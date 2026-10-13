'use strict';

// server.js cannot be loaded without booting the whole app, so a rule about its
// order is checked on the source text: the session middleware applies the
// disabled-account step before it exposes the logged-in streamer to routes and
// views.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('a disabled account is moved out of req.streamer before res.locals.streamer is set', () => {
  const apply = source.indexOf('applyAccountStatus(req);');
  const expose = source.indexOf('res.locals.streamer = req.streamer');
  const crossLoad = source.indexOf('req.streamer = db.getStreamerById(req.racingUser.streamer_id)');
  assert.ok(apply > 0, 'the session middleware applies the account status');
  assert.ok(crossLoad > 0 && apply > crossLoad, 'after a Racing login has loaded its linked streamer');
  assert.ok(expose > apply, 'before the streamer is shared with routes and views');
});
