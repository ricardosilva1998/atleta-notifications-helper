'use strict';

// Admin access is decided by Discord user id only. Display names and usernames
// can be changed by anyone, so they must never grant admin.
const DEFAULT_ADMIN_DISCORD_IDS = ['1424474220976672940'];

// The built-in admin ids plus any comma-separated ids from ADMIN_DISCORD_IDS.
// Entries that aren't numeric Discord ids are ignored.
function parseAdminDiscordIds(envValue) {
  const extra = String(envValue || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  return [...new Set([...DEFAULT_ADMIN_DISCORD_IDS, ...extra])];
}

function isAdminStreamer(streamer, adminDiscordIds) {
  if (!streamer || !streamer.discord_user_id) return false;
  return adminDiscordIds.includes(String(streamer.discord_user_id));
}

module.exports = { parseAdminDiscordIds, isAdminStreamer };
