const { test } = require('node:test');
const assert = require('node:assert');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Stub the modules the poller pulls in so it can be exercised without Twitch
// credentials or a Discord client.
function loadPoller(clipsByCall) {
  const twitchPath = require.resolve('../src/services/twitch');
  const discordPath = require.resolve('../src/discord');
  const clipsPath = require.resolve('../src/pollers/twitchClips');

  const calls = [];
  const stub = (filename, exports) => {
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  stub(twitchPath, {
    getClips: async (...args) => {
      calls.push(args);
      return typeof clipsByCall === 'function' ? clipsByCall(...args) : clipsByCall;
    },
    getUserId: async () => '632557806',
  });
  stub(discordPath, { buildEmbed: () => ({}) });

  delete require.cache[clipsPath];
  return { poller: require('../src/pollers/twitchClips'), calls };
}

function clip(createdAt, extra = {}) {
  return {
    id: `clip-${createdAt}`,
    created_at: createdAt,
    title: 'a clip',
    url: `https://clips.twitch.tv/${createdAt}`,
    view_count: 1,
    duration: 30,
    creator_name: 'someone',
    ...extra,
  };
}

const NOW = Date.parse('2026-08-17T22:40:00Z');

// The deadlock that silenced clip alerts: Twitch caps /clips at a one-week
// window when ended_at is omitted, so a channel with a week-long clip gap only
// ever gets the boundary clip back — which the "strictly newer" filter drops.
test('sends an explicit ended_at so Twitch does not cap the window at one week', async () => {
  const { poller, calls } = loadPoller([]);

  await poller.check('andre_vilela_', {
    twitch_broadcaster_id: '632557806',
    last_clip_created_at: '2026-03-29T21:50:28Z',
  }, NOW);

  assert.strictEqual(calls.length, 1);
  const [, startedAt, endedAt] = calls[0];
  assert.ok(endedAt, 'ended_at must be passed to getClips');
  assert.ok(!Number.isNaN(Date.parse(endedAt)), `ended_at must be a valid timestamp, got ${endedAt}`);
  assert.ok(Date.parse(endedAt) >= Date.parse(startedAt), 'window must not be inverted');
});

test('clamps the look-back so a months-stalled channel does not replay old clips', async () => {
  const { poller, calls } = loadPoller([]);

  await poller.check('andre_vilela_', {
    twitch_broadcaster_id: '632557806',
    last_clip_created_at: '2026-03-29T21:50:28Z',
  }, NOW);

  const [, startedAt] = calls[0];
  assert.strictEqual(
    Date.parse(startedAt),
    NOW - DAY,
    'a stale last_clip_created_at must be clamped forward to the look-back floor',
  );
});

test('keeps a recent last_clip_created_at as the window start', async () => {
  const { poller, calls } = loadPoller([]);
  const recent = new Date(NOW - 2 * HOUR).toISOString();

  await poller.check('andre_vilela_', {
    twitch_broadcaster_id: '632557806',
    last_clip_created_at: recent,
  }, NOW);

  assert.strictEqual(Date.parse(calls[0][1]), Date.parse(recent));
});

test('notifies clips newer than the last seen one and advances the state', async () => {
  const older = new Date(NOW - 3 * HOUR).toISOString();
  const newer = new Date(NOW - 1 * HOUR).toISOString();
  const { poller } = loadPoller([clip(older), clip(newer)]);

  const result = await poller.check('andre_vilela_', {
    twitch_broadcaster_id: '632557806',
    last_clip_created_at: new Date(NOW - 4 * HOUR).toISOString(),
  }, NOW);

  assert.strictEqual(result.notify, true);
  assert.strictEqual(result.clipData.length, 2);
  assert.strictEqual(result.stateUpdate.last_clip_created_at, newer);
});

// Twitch orders /clips by view count, not by date, so the newest clip is not
// necessarily last in the response.
test('advances to the newest clip even when Twitch returns them out of date order', async () => {
  const newest = new Date(NOW - 1 * HOUR).toISOString();
  const middle = new Date(NOW - 2 * HOUR).toISOString();
  const { poller } = loadPoller([clip(newest, { view_count: 900 }), clip(middle, { view_count: 5 })]);

  const result = await poller.check('andre_vilela_', {
    twitch_broadcaster_id: '632557806',
    last_clip_created_at: new Date(NOW - 5 * HOUR).toISOString(),
  }, NOW);

  assert.strictEqual(result.stateUpdate.last_clip_created_at, newest);
});

test('does not re-notify the boundary clip whose created_at equals the stored one', async () => {
  const boundary = new Date(NOW - 2 * HOUR).toISOString();
  const { poller } = loadPoller([clip(boundary)]);

  const result = await poller.check('andre_vilela_', {
    twitch_broadcaster_id: '632557806',
    last_clip_created_at: boundary,
  }, NOW);

  assert.strictEqual(result, null);
});

test('resolves the broadcaster id first when it is missing', async () => {
  const { poller, calls } = loadPoller([]);

  const result = await poller.check('andre_vilela_', { last_clip_created_at: null }, NOW);

  assert.strictEqual(calls.length, 0, 'must not query clips before the id is known');
  assert.deepStrictEqual(result, { notify: false, stateUpdate: { twitch_broadcaster_id: '632557806' } });
});
