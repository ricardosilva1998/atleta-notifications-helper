const config = require('../config');
const db = require('../db');
const { getSubscribers, getUserId, refreshBroadcasterToken } = require('../services/twitch');
const { client } = require('../discord');
const { subRoleEligibility, roleFacts, botTopRolePosition } = require('../services/discordGuards');

// A refused sub role is logged once per streamer and server (again only if the
// role or the reason changes), not every 10 minutes.
const refusedRoles = new Map(); // `${streamerId}:${guildId}` -> `${roleId}:${reason}`

function noteRefusedRole(streamer, guild, roleId, reason) {
  const key = `${streamer.id}:${guild.id}`;
  const value = `${roleId}:${reason}`;
  if (refusedRoles.get(key) === value) return;
  refusedRoles.set(key, value);
  console.warn(`[SubSync] ${streamer.twitch_username}: sub role ${roleId} in ${guild.name} is not usable (${reason}) — skipping sync there`);
}

// A note about a server the streamer has since released would stay for good, and
// would hide the first refusal if the server is claimed again. Pruned at the
// start of each cycle, so no timer is needed.
function forgetRefusedRolesOfUnclaimedServers(streamer) {
  const claimed = new Set(db.getGuildsForStreamer(streamer.id).map((g) => String(g.guild_id)));
  const prefix = `${streamer.id}:`;
  for (const key of refusedRoles.keys()) {
    if (key.startsWith(prefix) && !claimed.has(key.slice(prefix.length))) refusedRoles.delete(key);
  }
}

async function checkStreamer(streamer) {
  forgetRefusedRolesOfUnclaimedServers(streamer);

  if (!streamer.broadcaster_access_token) {
    return;
  }

  if (!streamer.twitch_username) {
    console.log(`[SubSync] Streamer ${streamer.id} has no Twitch linked, skipping`);
    return;
  }

  // Get broadcaster ID — try channel_state first, then poller_state, then resolve it
  let broadcasterId;
  const channelState = db.getChannelState(streamer.twitch_username);
  broadcasterId = channelState?.twitch_broadcaster_id;

  if (!broadcasterId) {
    const pollerState = db.getPollerState(streamer.id);
    broadcasterId = pollerState?.twitch_broadcaster_id;
  }

  if (!broadcasterId) {
    broadcasterId = await getUserId(streamer.twitch_username);
    if (broadcasterId) {
      db.updateChannelState(streamer.twitch_username, { twitch_broadcaster_id: broadcasterId });
    }
  }

  if (!broadcasterId) {
    console.log(`[SubSync] Could not resolve broadcaster ID for ${streamer.twitch_username}`);
    return;
  }

  let accessToken = streamer.broadcaster_access_token;
  if (Date.now() >= streamer.broadcaster_token_expires_at) {
    try {
      accessToken = await refreshBroadcasterToken(streamer);
    } catch (error) {
      // A dead refresh token can never recover on its own. Clear the scopes so
      // the dashboard prompts for re-authorization, and stop retrying every
      // poll — this is also the only detector when neither the overlay nor the
      // chatbot is on (and so there is no EventSub client) for this streamer.
      if (error.code === 'INVALID_REFRESH_TOKEN') {
        db.clearStreamerBroadcasterScopes(streamer.id);
        console.warn(`[SubSync] ${streamer.twitch_username}: broadcaster token permanently invalid — cleared scopes, re-authorization required`);
        return;
      }
      throw error;
    }
  }

  const subscribers = await getSubscribers(broadcasterId, accessToken);
  const subscriberTwitchIds = new Set(subscribers.map((s) => s.user_id));
  const linkedUsers = db.getLinkedUsers(streamer.id);
  const guilds = db.getGuildsForStreamer(streamer.id).filter((g) => g.sub_sync_enabled && g.sub_role_id);
  const linkedSubs = linkedUsers.filter((l) => subscriberTwitchIds.has(l.twitch_user_id)).length;
  // Counts only: who is linked to whom stays in the database, not in the logs.
  console.log(`[SubSync] ${streamer.twitch_username}: ${subscribers.length} subscribers, ${linkedUsers.length} linked users (${linkedSubs} subscribed), ${guilds.length} server(s) syncing`);

  for (const guildConfig of guilds) {
    const guild = client.guilds.cache.get(guildConfig.guild_id);
    if (!guild) continue;

    // The role is re-checked every cycle: it may have been given moderator
    // permissions, moved above the bot, or deleted since it was chosen.
    const role = guild.roles.cache.get(guildConfig.sub_role_id);
    const eligibility = subRoleEligibility(roleFacts(role), await botTopRolePosition(guild));
    if (!eligibility.ok) {
      noteRefusedRole(streamer, guild, guildConfig.sub_role_id, eligibility.reason);
      continue;
    }
    refusedRoles.delete(`${streamer.id}:${guild.id}`);

    for (const link of linkedUsers) {
      try {
        const member = await guild.members.fetch(link.discord_user_id).catch(() => null);
        if (!member) continue;

        const isSub = subscriberTwitchIds.has(link.twitch_user_id);
        const hasRole = member.roles.cache.has(guildConfig.sub_role_id);

        if (isSub && !hasRole) {
          await member.roles.add(role);
          console.log(`[SubSync] +role ${member.user.username} in ${guild.name}`);
        } else if (!isSub && hasRole) {
          await member.roles.remove(role);
          console.log(`[SubSync] -role ${member.user.username} in ${guild.name}`);
        }
      } catch (error) {
        console.error(`[SubSync] Role sync error: ${error.message}`);
      }
    }
  }
}

module.exports = { checkStreamer };
