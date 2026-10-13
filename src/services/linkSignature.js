'use strict';

// /link URLs come from the bot's reply to a Discord slash command, the only
// place that knows which Discord user asked. The URL carries streamer_id,
// discord_id and an expiry (exp, Unix seconds) plus an HMAC-SHA256 signature
// over them, so the web side links a Twitch account only to the Discord user
// the bot replied to, and only while the link is fresh.

const crypto = require('crypto');

const LINK_TTL_SECONDS = 15 * 60;

const FIELD_FORMATS = {
  streamer_id: /^[1-9]\d{0,15}$/,
  discord_id: /^\d{17,20}$/,
  exp: /^\d{1,12}$/,
  sig: /^[A-Za-z0-9_-]{43}$/, // base64url HMAC-SHA256
};

function signature(streamerId, discordId, exp, secret) {
  return crypto.createHmac('sha256', secret)
    .update(`atleta-link:v1|${streamerId}|${discordId}|${exp}`)
    .digest('base64url');
}

// Returns the query fields of a /link URL: { streamer_id, discord_id, exp, sig }.
function signLink({ streamerId, discordId, now = Date.now(), ttlSeconds = LINK_TTL_SECONDS }, secret) {
  const streamer_id = String(streamerId);
  const discord_id = String(discordId);
  const exp = String(Math.floor(now / 1000) + ttlSeconds);
  return { streamer_id, discord_id, exp, sig: signature(streamer_id, discord_id, exp, secret) };
}

// { ok: true, streamerId, discordId } for a link this server signed that has
// not expired; otherwise { ok: false, reason } with reason one of
// missing | malformed | bad_signature | expired.
function verifyLink(fields, secret, now = Date.now()) {
  const f = fields || {};
  if (!f.streamer_id || !f.discord_id || !f.exp || !f.sig) return { ok: false, reason: 'missing' };
  for (const [name, format] of Object.entries(FIELD_FORMATS)) {
    if (typeof f[name] !== 'string' || !format.test(f[name])) return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(signature(f.streamer_id, f.discord_id, f.exp, secret));
  const given = Buffer.from(f.sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (Math.floor(now / 1000) > Number(f.exp)) return { ok: false, reason: 'expired' };
  return { ok: true, streamerId: Number(f.streamer_id), discordId: f.discord_id };
}

let bootSecret = null;

// LINK_SIGNING_SECRET, or a random secret made once per boot — links handed
// out before a restart then stop working and the page asks to run /link again.
function linkSecret() {
  const configured = require('../config').link.signingSecret;
  if (configured) return configured;
  if (!bootSecret) {
    bootSecret = crypto.randomBytes(32);
    console.warn('[Link] LINK_SIGNING_SECRET is not set — /link links use a per-boot secret and stop working after a restart');
  }
  return bootSecret;
}

module.exports = { LINK_TTL_SECONDS, signLink, verifyLink, linkSecret };
