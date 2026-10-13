'use strict';

// Filling in missing channel pictures and names after the server page was sent:
// a fake db and fake lookups, and a fake clock, so nothing is waited for.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RETRY_AFTER_MS, lookupDue, twitchRowsDue, youtubeRowsDue, backfillInBackground } = require('./channelInfoBackfill');

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600_000).toISOString();

const realWarn = console.warn;
beforeEach(() => { console.warn = () => {}; });
afterEach(() => { console.warn = realWarn; });

describe('lookupDue', () => {
  test('a row never tried is due', () => {
    assert.equal(lookupDue(null, NOW), true);
    assert.equal(lookupDue(undefined, NOW), true);
    assert.equal(lookupDue('', NOW), true);
  });

  test('a row tried within the last 24 hours is not due', () => {
    assert.equal(RETRY_AFTER_MS, 24 * 3600_000);
    assert.equal(lookupDue(hoursAgo(0), NOW), false);
    assert.equal(lookupDue(hoursAgo(1), NOW), false);
    assert.equal(lookupDue(hoursAgo(23.99), NOW), false);
  });

  test('a row tried 24 hours ago or more is due again', () => {
    assert.equal(lookupDue(hoursAgo(24), NOW), true);
    assert.equal(lookupDue(hoursAgo(25), NOW), true);
    assert.equal(lookupDue(hoursAgo(24 * 30), NOW), true);
  });

  test('a time that cannot be read, or lies in the future, does not block the row for ever', () => {
    assert.equal(lookupDue('yesterday', NOW), true);
    assert.equal(lookupDue(new Date(NOW + 3600_000).toISOString(), NOW), true);
  });
});

describe('which rows are due', () => {
  test('Twitch: only rows without a picture that are due', () => {
    const rows = [
      { id: 1, profile_image_url: null, info_attempted_at: null },
      { id: 2, profile_image_url: 'https://img.test/b.png', info_attempted_at: null },
      { id: 3, profile_image_url: null, info_attempted_at: hoursAgo(2) },
      { id: 4, profile_image_url: '', info_attempted_at: hoursAgo(30) },
    ];
    assert.deepEqual(twitchRowsDue(rows, NOW).map((r) => r.id), [1, 4]);
  });

  test('YouTube: rows missing the picture or the name that are due', () => {
    const rows = [
      { id: 1, profile_image_url: null, youtube_channel_name: 'A', info_attempted_at: null },
      { id: 2, profile_image_url: 'https://img.test/b.png', youtube_channel_name: null, info_attempted_at: null },
      { id: 3, profile_image_url: 'https://img.test/c.png', youtube_channel_name: 'C', info_attempted_at: null },
      { id: 4, profile_image_url: null, youtube_channel_name: null, info_attempted_at: hoursAgo(1) },
      { id: 5, profile_image_url: null, youtube_channel_name: null, info_attempted_at: hoursAgo(48) },
    ];
    assert.deepEqual(youtubeRowsDue(rows, NOW).map((r) => r.id), [1, 2, 5]);
  });
});

describe('backfillInBackground', () => {
  function fakes(over = {}) {
    const marks = [];
    const updates = [];
    const lookups = [];
    return {
      marks, updates, lookups,
      db: {
        markWatchedChannelInfoAttempt: (id, at) => marks.push(['twitch', id, at]),
        markWatchedYoutubeChannelInfoAttempt: (id, at) => marks.push(['youtube', id, at]),
        updateWatchedChannelProfileImage: (id, url) => updates.push(['twitch', id, url]),
        updateWatchedYoutubeChannelInfo: (id, url, name) => updates.push(['youtube', id, url, name]),
      },
      getUserProfile: async (login, options) => { lookups.push(['profile', login, options]); return { profile_image_url: `https://img.test/${login}.png` }; },
      getChannelInfo: async (channelId, options) => { lookups.push(['info', channelId, options]); return { profileImageUrl: `https://img.test/${channelId}.png`, channelName: `Name of ${channelId}` }; },
      now: () => NOW,
      ...over,
    };
  }
  const run = (rows, f) => backfillInBackground(rows, f);

  test('marks every row as tried before the first lookup starts', async () => {
    const f = fakes();
    const done = run({ twitchRows: [{ id: 1, twitch_username: 'a' }, { id: 2, twitch_username: 'b' }], youtubeRows: [{ id: 3, youtube_channel_id: 'UCc' }] }, f);
    // Nothing has been awaited yet: the marks are already made, the lookups have not finished.
    assert.deepEqual(f.marks, [
      ['twitch', 1, '2026-10-13T12:00:00.000Z'], ['twitch', 2, '2026-10-13T12:00:00.000Z'], ['youtube', 3, '2026-10-13T12:00:00.000Z'],
    ]);
    assert.deepEqual(f.updates, []);
    await done;
  });

  test('fills in the pictures and the YouTube names', async () => {
    const f = fakes();
    await run({ twitchRows: [{ id: 1, twitch_username: 'a' }], youtubeRows: [{ id: 3, youtube_channel_id: 'UCc', profile_image_url: null }] }, f);
    assert.deepEqual(f.updates, [
      ['twitch', 1, 'https://img.test/a.png'],
      ['youtube', 3, 'https://img.test/UCc.png', 'Name of UCc'],
    ]);
  });

  test('looks the rows up one after the other, each with its own 3 s deadline', async () => {
    const f = fakes();
    await run({ twitchRows: [{ id: 1, twitch_username: 'a' }, { id: 2, twitch_username: 'b' }], youtubeRows: [{ id: 3, youtube_channel_id: 'UCc' }] }, f);
    assert.deepEqual(f.lookups.map((l) => l.slice(0, 2)), [['profile', 'a'], ['profile', 'b'], ['info', 'UCc']]);
    const signals = f.lookups.map((l) => l[2].signal);
    assert.ok(signals.every((s) => s instanceof AbortSignal && !s.aborted));
    assert.equal(new Set(signals).size, 3, 'a signal per lookup, not one for all');
  });

  test('a lookup that finds nothing changes nothing, but the row stays marked as tried', async () => {
    const f = fakes({ getUserProfile: async () => null, getChannelInfo: async () => ({ profileImageUrl: null, channelName: null }) });
    await run({ twitchRows: [{ id: 1, twitch_username: 'a' }], youtubeRows: [{ id: 3, youtube_channel_id: 'UCc' }] }, f);
    assert.deepEqual(f.updates, []);
    assert.equal(f.marks.length, 2);
  });

  test('a failing lookup does not stop the others, never rejects, and is not retried before 24 hours', async () => {
    const f = fakes({
      getUserProfile: async (login) => { if (login === 'a') throw new Error('Twitch API error: 500'); return { profile_image_url: 'https://img.test/b.png' }; },
    });
    await run({ twitchRows: [{ id: 1, twitch_username: 'a' }, { id: 2, twitch_username: 'b' }], youtubeRows: [] }, f);
    assert.deepEqual(f.updates, [['twitch', 2, 'https://img.test/b.png']]);
    assert.deepEqual(f.marks.map((m) => m[1]), [1, 2]);
  });

  test('a YouTube page that gives only a name keeps the picture the row already has', async () => {
    const f = fakes({ getChannelInfo: async () => ({ profileImageUrl: null, channelName: 'Just A Name' }) });
    await run({ twitchRows: [], youtubeRows: [{ id: 3, youtube_channel_id: 'UCc', profile_image_url: 'https://img.test/kept.png' }] }, f);
    assert.deepEqual(f.updates, [['youtube', 3, 'https://img.test/kept.png', 'Just A Name']]);
  });

  test('with nothing due there is no work and no mark', async () => {
    const f = fakes();
    await run({ twitchRows: [], youtubeRows: [] }, f);
    await run({}, f);
    assert.deepEqual(f.marks, []);
    assert.deepEqual(f.lookups, []);
  });

  test('a lookup that hangs is cut at its deadline and the next row still gets its turn', async () => {
    const f = fakes({
      timeoutMs: 40,
      getUserProfile: (login, options) => (login === 'a'
        ? new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
        : Promise.resolve({ profile_image_url: 'https://img.test/b.png' })),
    });
    const started = Date.now();
    await run({ twitchRows: [{ id: 1, twitch_username: 'a' }, { id: 2, twitch_username: 'b' }], youtubeRows: [] }, f);
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(f.updates, [['twitch', 2, 'https://img.test/b.png']]);
  });
});
