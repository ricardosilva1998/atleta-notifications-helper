'use strict';

// config.js reads the environment once, when it is loaded, so each case loads
// it afresh. The required variables get synthetic values (it exits without them).

const { test } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'synthetic';
}

function chatRateLimitWith(value) {
  const saved = process.env.BOT_CHAT_RATE_LIMIT;
  if (value === undefined) delete process.env.BOT_CHAT_RATE_LIMIT;
  else process.env.BOT_CHAT_RATE_LIMIT = value;
  delete require.cache[require.resolve('./config')];
  try {
    return require('./config').bot.chatMessagesPer30s;
  } finally {
    if (saved === undefined) delete process.env.BOT_CHAT_RATE_LIMIT;
    else process.env.BOT_CHAT_RATE_LIMIT = saved;
  }
}

test('the shared Twitch bot may post 20 messages per 30 s, or what BOT_CHAT_RATE_LIMIT says (1-100)', () => {
  assert.equal(chatRateLimitWith(undefined), 20);
  for (const unreadable of ['', 'abc', '0', '-5']) assert.equal(chatRateLimitWith(unreadable), 20, unreadable);
  assert.equal(chatRateLimitWith('1'), 1);
  assert.equal(chatRateLimitWith('50'), 50);
  assert.equal(chatRateLimitWith('5000'), 100);
});

function weeklyDigestIntervalWith(value) {
  const saved = process.env.WEEKLY_DIGEST_INTERVAL;
  if (value === undefined) delete process.env.WEEKLY_DIGEST_INTERVAL;
  else process.env.WEEKLY_DIGEST_INTERVAL = value;
  delete require.cache[require.resolve('./config')];
  try {
    return require('./config').intervals.weeklyDigest;
  } finally {
    if (saved === undefined) delete process.env.WEEKLY_DIGEST_INTERVAL;
    else process.env.WEEKLY_DIGEST_INTERVAL = saved;
  }
}

test('the weekly digest poller ticks every 20 minutes unless WEEKLY_DIGEST_INTERVAL says otherwise, so a failed post is retried within its hour', () => {
  assert.equal(weeklyDigestIntervalWith(undefined), 20 * 60 * 1000);
  assert.equal(weeklyDigestIntervalWith(''), 20 * 60 * 1000);
  assert.equal(weeklyDigestIntervalWith('abc'), 20 * 60 * 1000);
  assert.equal(weeklyDigestIntervalWith('3600000'), 3_600_000);
});
