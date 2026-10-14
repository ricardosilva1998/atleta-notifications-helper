'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const presence = require('./overlayPresence');

test('a streamer\'s alert overlay is open while at least one of its streams is, never below none', () => {
  assert.equal(presence.isOpen(91), false);
  presence.opened(91);
  presence.opened(91);
  presence.closed(91);
  assert.equal(presence.isOpen(91), true, 'one of two is still open');
  presence.closed(91);
  assert.equal(presence.isOpen(91), false);
  presence.closed(91);
  presence.opened(91);
  assert.equal(presence.isOpen(91), true, 'an extra close does not hide the next open');
  presence.closed(91);
  assert.equal(presence.isOpen(92), false, 'per streamer');
});
