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

  test("the streamer's where text and the server name arrive escaped", () => {
    const e = m.viewerMessage('accepted', {
      booking: booking(), streamerName: 'Coach', guildName: 'HQ [join](https://evil.example)', inviteUrl: 'https://discord.gg/abc',
      whereText: 'Room [here](https://evil.example)', bookingUrl: 'b', t,
    }).embeds[0];
    assert.ok(e.description.includes(escapeLinkText('HQ [join](https://evil.example)')));
    assert.ok(e.description.includes(escapeLinkText('Room [here](https://evil.example)')));
    assert.ok(!e.description.includes('[join](') && !e.description.includes('[here]('));
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

describe('coachingMessages: payment kinds', () => {
  const missing = (text) => assert.ok(!/coaching\.message\./.test(text), `a text key was left in: ${text}`);

  test('formatPrice writes the amount in the reader\'s language and falls back on an unknown currency', () => {
    assert.equal(m.formatPrice(2500, 'EUR', 'en'), '€25.00');
    assert.equal(m.formatPrice(4500, 'USD', 'en'), '$45.00');
    assert.match(m.formatPrice(2500, 'EUR', 'pt'), /25,00/, 'a decimal comma in Portuguese');
    assert.equal(m.formatPrice(2500, 'nope', 'en'), '€25.00', 'a currency that is not a code reads as EUR');
  });

  test('acceptedPay carries the price, the deadline and the booking page, and no where line', () => {
    const payBy = 1793000000000 - 15 * 60e3;
    const msg = m.viewerMessage('acceptedPay', {
      booking: booking({ price_cents: 4500, currency: 'EUR', pay_by: payBy }), streamerName: 'Coach', guildName: 'HQ',
      inviteUrl: 'https://discord.gg/abc', whereText: 'Voice room', bookingUrl: 'https://atleta.test/coaching/coach', lang: 'en', t,
    });
    const e = msg.embeds[0];
    assert.equal(e.title, 'Coach accepted your coaching session: pay to confirm it');
    assert.match(e.description, /Price: €45\.00/);
    assert.match(e.description, new RegExp(`Pay by: <t:${Math.floor(payBy / 1000)}:F>`));
    assert.match(e.description, /Pay on the booking page: https:\/\/atleta\.test\/coaching\/coach/);
    assert.ok(!/Voice room|Invite/.test(e.description), 'the place comes once it is paid');
    missing(e.title + e.description);
  });

  test('confirmed names the amount paid and the room link in place of the where text; without a room, the where text', () => {
    const paid = booking({ paid_amount_cents: 2500, paid_currency: 'EUR' });
    const base = { booking: paid, streamerName: 'Coach', guildName: 'HQ', inviteUrl: null, whereText: '[x](https://evil.example)', bookingUrl: 'u', lang: 'en', t };
    const room = m.viewerMessage('confirmed', { ...base, roomUrl: 'https://discord.com/channels/1/2' }).embeds[0];
    assert.equal(room.title, 'Your coaching session with Coach is confirmed');
    assert.match(room.description, /Paid: €25\.00/);
    assert.match(room.description, /Your room: https:\/\/discord\.com\/channels\/1\/2/);
    assert.ok(!room.description.includes('Where:'));
    const where = m.viewerMessage('confirmed', { ...base, roomUrl: null }).embeds[0];
    assert.ok(where.description.includes(`Where: ${escapeLinkText('[x](https://evil.example)')}`), 'the where text is escaped');
    missing(room.description + where.description);
  });

  test('expired (viewer) offers another time; unpaid, paid and paymentLate (streamer) carry what the streamer needs', () => {
    const b = booking({ viewer_display_name: '[Vi](https://evil.example)', paid_amount_cents: 2500, paid_currency: 'EUR', price_cents: 2500, currency: 'EUR' });
    const exp = m.viewerMessage('expired', { booking: b, streamerName: 'Coach', bookingUrl: 'https://atleta.test/coaching/coach', lang: 'en', t }).embeds[0];
    assert.equal(exp.title, 'Your coaching session with Coach was not paid in time');
    assert.match(exp.description, /Pick another time: https:\/\/atleta\.test\/coaching\/coach/);
    const s = (kind) => m.streamerMessage(kind, { booking: b, scheduleUrl: 'https://atleta.test/dashboard/coaching', lang: 'en', t }).embeds[0];
    const name = escapeLinkText('[Vi](https://evil.example)');
    assert.equal(s('unpaid').title, `${name} did not pay in time: the time is free again`);
    assert.equal(s('paid').title, `${name} paid for their coaching session`);
    assert.match(s('paid').description, /Paid: €25\.00/);
    const late = s('paymentLate');
    assert.match(late.description, /Paid: €25\.00/);
    assert.match(late.description, /refund it to the viewer in PayPal/);
    assert.match(s('request').description, /Price: €25\.00/, 'a paid request names its price');
    assert.ok(!/Price/.test(m.streamerMessage('request', { booking: booking({ price_cents: 0 }), scheduleUrl: 'u', lang: 'en', t }).embeds[0].description), 'a free one does not');
    for (const k of ['unpaid', 'paid', 'paymentLate', 'request']) missing(s(k).title + s(k).description);
  });

  test('the cancelled message carries the coach\'s reason, escaped, and the refund line only for a paid session', () => {
    const base = { booking: booking(), streamerName: 'Coach', bookingUrl: 'https://x/coaching/coach', t };
    const paid = m.viewerMessage('cancelled', { ...base, reason: 'Ill [click](https://evil.example)', refund: true }).embeds[0];
    assert.match(paid.title, /Coach cancelled your coaching session/);
    assert.match(paid.description, /Reason: Ill/);
    assert.match(paid.description, /\\\]\(https/, 'the bracket is escaped, so it cannot become a link');
    assert.match(paid.description, /Your coach will refund you in PayPal\./);
    assert.match(paid.description, /https:\/\/x\/coaching\/coach/);
    const free = m.viewerMessage('cancelled', { ...base, reason: 'Ill', refund: false }).embeds[0];
    assert.doesNotMatch(free.description, /refund/);
    const none = m.viewerMessage('cancelled', base).embeds[0];
    assert.doesNotMatch(none.description, /Reason:/);
  });

  test('the refunded message names the coach and the amount, and offers nothing to book', () => {
    const e = m.viewerMessage('refunded', {
      booking: booking({ paid_amount_cents: 4500, paid_currency: 'EUR' }), streamerName: 'Coach', bookingUrl: 'https://x/b', lang: 'en', t,
    }).embeds[0];
    assert.match(e.title, /Coach refunded your coaching session/);
    assert.match(e.description, /refund has been sent through PayPal/);
    assert.match(e.description, /45\.00/);
    assert.doesNotMatch(e.description, /Pick another time/);
    assert.equal(e.color, 0x3ecf8e);
  });
});

describe('reschedule messages', () => {
  const moving = (over = {}) => booking({ original_starts_at: 1793000000000, proposal_starts_at: 1793100000000, proposal_note: '[x](http://e.example)', ...over });
  const args = { streamerName: 'Coach', guildName: 'Coach HQ', bookingUrl: 'https://x/coaching/coach', bookingLink: 'https://x/coaching/coach?booking=1', roomUrl: null, t };

  test('a coach proposal names the original and the proposed time, the note without a live link, and the booking link', () => {
    const e = m.viewerMessage('rescheduleProposed', { ...args, booking: moving() }).embeds[0];
    assert.match(e.title, /Coach proposed a new time/);
    assert.match(e.description, /Original time: <t:1793000000:F>/);
    assert.match(e.description, /Proposed time: <t:1793100000:F>/);
    assert.ok(!e.description.includes('[x]('), 'the note cannot make a link');
    assert.match(e.description, /\?booking=1/);
  });

  test('way 2, a lapse and the other viewer kinds each carry the link or their line', () => {
    assert.match(m.viewerMessage('rescheduleAsk', { ...args, booking: moving({ proposal_starts_at: null }) }).embeds[0].description, /Pick a new time here: https:\/\/x\/coaching\/coach\?booking=1/);
    const lapsed = m.viewerMessage('proposalLapsed', { ...args, booking: moving({ proposal_starts_at: null }) }).embeds[0];
    assert.match(lapsed.description, /dropped/);
    assert.match(lapsed.description, /\?booking=1/);
    assert.match(m.viewerMessage('proposal', { ...args, booking: moving() }).embeds[0].title, /another time/);
  });

  test('agreed shows the new time and the room, never the proposal lines', () => {
    const agreed = m.viewerMessage('rescheduleAgreed', { ...args, roomUrl: 'https://discord.com/channels/1/2', booking: booking({ starts_at: 1793100000000 }) }).embeds[0];
    assert.match(agreed.title, /new time/);
    assert.match(agreed.description, /New time: <t:1793100000:F>/);
    assert.match(agreed.description, /discord\.com\/channels\/1\/2/);
    assert.doesNotMatch(agreed.description, /Proposed time/);
    assert.equal(agreed.color, 0x3ecf8e);
  });

  test('not rescheduled: the refund line only for a paid session, to the viewer and to the coach in their own words', () => {
    const free = m.viewerMessage('notRescheduled', { ...args, booking: moving({ proposal_starts_at: null }), refund: false }).embeds[0];
    assert.doesNotMatch(free.description, /refund/);
    const paid = m.viewerMessage('notRescheduled', { ...args, booking: moving({ proposal_starts_at: null }), refund: true }).embeds[0];
    assert.match(paid.description, /refund you/);
    const coach = m.streamerMessage('notRescheduledCoach', { booking: moving({ proposal_starts_at: null }), scheduleUrl: 'https://x/dashboard/coaching', refund: true, t }).embeds[0];
    assert.match(coach.description, /Refunded/);
    assert.match(coach.description, /dashboard\/coaching/);
  });

  test('the coach\'s kinds name the viewer through escapeLinkText and carry the schedule link', () => {
    const b = moving({ viewer_display_name: '[Vi](http://e.example)' });
    for (const kind of ['viewerProposed', 'agreedCoach', 'viewerLapsed', 'notRescheduledCoach']) {
      const e = m.streamerMessage(kind, { booking: b, scheduleUrl: 'https://x/dashboard/coaching', t }).embeds[0];
      assert.ok(e.title.includes('\\[Vi\\]'), kind);
      if (kind !== 'agreedCoach') assert.match(e.description, /dashboard\/coaching/, kind);
    }
  });
});
