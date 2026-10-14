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

test('the weekly digest poller ticks every 15 minutes unless WEEKLY_DIGEST_INTERVAL says otherwise, so a failed post is retried within its hour', () => {
  assert.equal(weeklyDigestIntervalWith(undefined), 15 * 60 * 1000);
  assert.equal(weeklyDigestIntervalWith(''), 15 * 60 * 1000);
  assert.equal(weeklyDigestIntervalWith('abc'), 15 * 60 * 1000);
  assert.equal(weeklyDigestIntervalWith('3600000'), 3_600_000);
});

// Loads config.js with these variables set (undefined: unset), then restores
// them. process.exit is caught: config.js calls it when a required one is missing.
function loadWith(env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const realExit = process.exit;
  const realError = console.error;
  const errors = [];
  process.exit = (code) => { throw Object.assign(new Error('exit'), { exitCode: code }); };
  console.error = (...args) => errors.push(args.join(' '));
  delete require.cache[require.resolve('./config')];
  try {
    return { config: require('./config'), errors };
  } catch (e) {
    if (e.exitCode === undefined) throw e;
    return { exitCode: e.exitCode, errors };
  } finally {
    process.exit = realExit;
    console.error = realError;
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const NO_DISCORD = { DISCORD_TOKEN: undefined, DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined };

test('without DISCORD_DISABLED, a missing Discord variable stops the app at boot', () => {
  const { exitCode, errors } = loadWith({ ...NO_DISCORD, DISCORD_DISABLED: undefined });
  assert.equal(exitCode, 1);
  assert.match(errors.join('\n'), /DISCORD_TOKEN/);
});

test('DISCORD_DISABLED=1 (development and CI) boots without the Discord variables', () => {
  const { config, exitCode } = loadWith({ ...NO_DISCORD, DISCORD_DISABLED: '1' });
  assert.equal(exitCode, undefined);
  assert.equal(config.discord.disabled, true);
});

test('Twitch is still required with DISCORD_DISABLED=1', () => {
  const { exitCode, errors } = loadWith({ ...NO_DISCORD, DISCORD_DISABLED: '1', TWITCH_CLIENT_SECRET: undefined });
  assert.equal(exitCode, 1);
  assert.match(errors.join('\n'), /TWITCH_CLIENT_SECRET/);
  assert.doesNotMatch(errors.join('\n'), /DISCORD/);
});

test('Discord is on unless DISCORD_DISABLED is exactly 1', () => {
  for (const value of [undefined, '', '0', 'true', 'yes']) {
    assert.equal(loadWith({ DISCORD_DISABLED: value }).config.discord.disabled, false, String(value));
  }
});

const TOKEN_KEY = '0123456789abcdef'.repeat(4); // synthetic

test('TOKEN_ENCRYPTION_KEY: unset means no encryption key; 64 hex characters are taken (spaces around them trimmed)', () => {
  assert.equal(loadWith({ TOKEN_ENCRYPTION_KEY: undefined }).config.tokenEncryption.key, '');
  assert.equal(loadWith({ TOKEN_ENCRYPTION_KEY: '' }).config.tokenEncryption.key, '');
  assert.equal(loadWith({ TOKEN_ENCRYPTION_KEY: TOKEN_KEY }).config.tokenEncryption.key, TOKEN_KEY);
  assert.equal(loadWith({ TOKEN_ENCRYPTION_KEY: ` ${TOKEN_KEY.toUpperCase()}\n` }).config.tokenEncryption.key, TOKEN_KEY.toUpperCase());
});

test('a TOKEN_ENCRYPTION_KEY that is set but is not 64 hex characters stops the app at boot, without printing it', () => {
  for (const bad of ['short', TOKEN_KEY.slice(0, 63), `${TOKEN_KEY}00`, `${TOKEN_KEY.slice(0, 62)}zz`, `"${TOKEN_KEY}"`]) {
    const { exitCode, errors } = loadWith({ TOKEN_ENCRYPTION_KEY: bad });
    assert.equal(exitCode, 1, bad);
    assert.match(errors.join('\n'), /TOKEN_ENCRYPTION_KEY must be 64 hex characters/, bad);
    assert.ok(!errors.join('\n').includes(bad), 'the value is not logged');
  }
});

// Synthetic relay settings; MULTISTREAM_KEY_SECRET is no longer read.
const RELAY = {
  MEDIAMTX_API_URL: 'https://relay.example.test',
  MEDIAMTX_INGEST_URL: 'rtmp://ingest.example.test/live',
  MEDIAMTX_API_TOKEN: 'synthetic-api-token',
  MEDIAMTX_WEBHOOK_SECRET: 'synthetic-webhook-secret',
};

test('multistream is offered only when all four relay settings are set', () => {
  const on = loadWith({ ...RELAY, MULTISTREAM_KEY_SECRET: undefined }).config.multistream;
  assert.equal(on.enabled, true);
  assert.equal(on.ingestUrl, RELAY.MEDIAMTX_INGEST_URL);
  for (const missing of Object.keys(RELAY)) {
    const { config } = loadWith({ ...RELAY, [missing]: undefined, MULTISTREAM_KEY_SECRET: 'f'.repeat(64) });
    assert.equal(config.multistream.enabled, false, `${missing} unset`);
  }
  const none = loadWith(Object.fromEntries(Object.keys(RELAY).map((key) => [key, undefined]))).config.multistream;
  assert.equal(none.enabled, false);
  assert.equal(none.ingestUrl, '', 'no made-up ingest address');
  assert.equal('keySecret' in none, false);
});

test('the relay API login is MEDIAMTX_API_USER (admin when unset) with MEDIAMTX_API_TOKEN; the Cloudflare Access token is optional', () => {
  const plain = loadWith({ ...RELAY, MEDIAMTX_API_USER: undefined, MEDIAMTX_CF_ACCESS_CLIENT_ID: undefined, MEDIAMTX_CF_ACCESS_CLIENT_SECRET: undefined }).config.multistream;
  assert.equal(plain.apiUser, 'admin');
  assert.equal(plain.apiToken, RELAY.MEDIAMTX_API_TOKEN);
  assert.equal(plain.accessClientId, '');
  assert.equal(plain.accessClientSecret, '');
  const full = loadWith({ ...RELAY, MEDIAMTX_API_USER: 'operator', MEDIAMTX_CF_ACCESS_CLIENT_ID: 'cf-id', MEDIAMTX_CF_ACCESS_CLIENT_SECRET: 'cf-secret' }).config.multistream;
  assert.equal(full.apiUser, 'operator');
  assert.equal(full.accessClientId, 'cf-id');
  assert.equal(full.accessClientSecret, 'cf-secret');
  assert.equal(full.enabled, true, 'neither is needed to switch the feature on');
});
