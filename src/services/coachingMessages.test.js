'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}
// The real escapeLinkText of src/discord.js (loading it needs the config's env; it does not log in).
const { escapeLinkText } = require('../discord');

const FILE = path.join(__dirname, 'coachingMessages.js');
let m;
const en = require('../locales/en.json');
const t = (key, p = {}) => (en[key] || key).replace(/\{\{(\w+)\}\}/g, (_, k) => p[k] ?? '');

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === FILE && request === '../discord') {
      return { escapeLinkText };
    }
    return origLoad(request, parent, isMain);
  };
  try { delete require.cache[FILE]; m = require(FILE); } finally { Module._load = origLoad; }
});

const booking = (over = {}) => ({
  id: 1, starts_at: 1793000000000, minutes: 60, note: null,
  viewer_username: 'vi', viewer_display_name: 'Vi', ...over,
});

describe('coachingMessages', () => {
  test('discordTime gives whole seconds', () => {
    assert.equal(m.discordTime(1793000123456), '<t:1793000123:F>');
  });

  test('the accepted message names the server, the where line and the invite', () => {
    const msg = m.viewerMessage('accepted', {
      booking: booking(), streamerName: 'Coach', guildName: 'Coach HQ', inviteUrl: 'https://discord.gg/abc',
      whereText: 'Voice room 2', bookingUrl: 'https://x/coaching/coach', t,
    });
    const e = msg.embeds[0];
    assert.equal(e.color, 0x3ecf8e);
    assert.match(e.title, /Coach accepted/);
    assert.match(e.description, /<t:1793000000:F>/);
    assert.match(e.description, /60 minutes/);
    assert.match(e.description, /Coach HQ/);
    assert.match(e.description, /Voice room 2/);
    assert.match(e.description, /https:\/\/discord\.gg\/abc/);
    const bare = m.viewerMessage('accepted', { booking: booking(), streamerName: 'C', guildName: null, inviteUrl: 'u', whereText: '', bookingUrl: 'b', t });
    assert.doesNotMatch(bare.embeds[0].description, /Server:|Where:/);
  });

  test('declined and cancelled carry the time and the booking link in red', () => {
    for (const kind of ['declined', 'cancelled']) {
      const e = m.viewerMessage(kind, { booking: booking(), streamerName: 'Coach', bookingUrl: 'https://x/coaching/coach', t }).embeds[0];
      assert.equal(e.color, 0xf04438);
      assert.match(e.description, /<t:1793000000:F>/);
      assert.match(e.description, /https:\/\/x\/coaching\/coach/);
    }
  });

  test("a viewer's note with @everyone and a markdown link arrives escaped (Review Focus 5)", () => {
    const msg = m.streamerMessage('request', {
      booking: booking({ viewer_display_name: 'Bad [x](http://e)', note: '@everyone [win](https://evil.example)' }),
      scheduleUrl: 'https://x/dashboard/coaching', t,
    });
    const e = msg.embeds[0];
    assert.ok(e.description.includes('\\[win\\](https://evil.example)'));
    assert.ok(!e.description.includes('[win]('));
    assert.ok(e.title.includes('\\[x\\]'));
    assert.match(e.description, /https:\/\/x\/dashboard\/coaching/);
    const w = m.streamerMessage('withdrawn', { booking: booking(), scheduleUrl: 's', t }).embeds[0];
    assert.doesNotMatch(w.description, /dashboard/);
  });
});
