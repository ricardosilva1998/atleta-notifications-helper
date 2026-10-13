'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  isStreamerDisabled, applyAccountStatus, requireActiveStreamer, accountDisabledChannel,
} = require('./streamerAccess');

describe('isStreamerDisabled', () => {
  test('only an explicit enabled = 0 disables an account', () => {
    assert.equal(isStreamerDisabled({ id: 5, enabled: 0 }), true);
    assert.equal(isStreamerDisabled({ id: 5, enabled: '0' }), true);
    assert.equal(isStreamerDisabled({ id: 5, enabled: 1 }), false);
    assert.equal(isStreamerDisabled({ id: 5, enabled: null }), false);
    assert.equal(isStreamerDisabled({ id: 5 }), false);
    assert.equal(isStreamerDisabled(null), false);
    assert.equal(isStreamerDisabled(undefined), false);
  });
});

describe('applyAccountStatus', () => {
  test('an enabled streamer stays logged in', () => {
    const streamer = { id: 5, enabled: 1 };
    const req = { streamer };
    applyAccountStatus(req);
    assert.equal(req.streamer, streamer);
    assert.equal(req.disabledStreamer, undefined);
  });

  test('a disabled streamer is no longer req.streamer, but is remembered as disabled', () => {
    const streamer = { id: 5, enabled: 0 };
    const req = { streamer };
    applyAccountStatus(req);
    assert.equal(req.streamer, null);
    assert.equal(req.disabledStreamer, streamer);
  });

  test('nobody logged in changes nothing', () => {
    const req = { streamer: undefined };
    applyAccountStatus(req);
    assert.equal(req.streamer, undefined);
    assert.equal(req.disabledStreamer, undefined);
  });
});

describe('requireActiveStreamer (the /dashboard guard)', () => {
  function run(req) {
    const out = { nexted: false, redirect: null, status: null, rendered: null };
    const res = {
      redirect(url) { out.redirect = url; },
      status(code) { out.status = code; return this; },
      render(view, locals) { out.rendered = { view, locals }; },
    };
    requireActiveStreamer(req, res, () => { out.nexted = true; });
    return out;
  }

  test('lets a logged-in, enabled streamer through', () => {
    assert.deepEqual(run({ streamer: { id: 5, enabled: 1 } }), { nexted: true, redirect: null, status: null, rendered: null });
  });

  test('sends someone who is not logged in to the login page', () => {
    const out = run({});
    assert.equal(out.nexted, false);
    assert.equal(out.redirect, '/auth/login');
  });

  test('shows a disabled streamer the account-disabled page with a 403, not the dashboard', () => {
    const req = { streamer: { id: 5, enabled: 0 } };
    applyAccountStatus(req); // what the session middleware does first
    const out = run(req);
    assert.equal(out.nexted, false);
    assert.equal(out.redirect, null);
    assert.equal(out.status, 403);
    assert.equal(out.rendered.view, 'account-disabled');
    assert.equal(out.rendered.locals.streamer, null);
  });
});

describe('accountDisabledChannel', () => {
  test('is one channel per streamer', () => {
    assert.equal(accountDisabledChannel(5), 'overlay-disabled:5');
    assert.notEqual(accountDisabledChannel(5), accountDisabledChannel(6));
  });
});
