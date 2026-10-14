const config = require('./config');
const db = require('./db');
const { client } = require('./discord');
const server = require('./server');
const commands = require('./commands');
const welcome = require('./welcome');
const pollers = require('./pollers/manager');
const { startDiscordLogin } = require('./services/discordLogin');

// Long-running server: a single unhandled rejection / uncaught exception must
// not take the process down. Log loudly and keep going — Railway will still
// crash-restart on a real fatal, this just buys us a recovery window.
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection:', err && err.stack || err);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack || err);
});

// Stored OAuth tokens are encrypted only when TOKEN_ENCRYPTION_KEY is set (db.js).
if (!db.tokenEncryptionEnabled) {
  console.warn('[DB] TOKEN_ENCRYPTION_KEY is not set: OAuth tokens and the StreamElements token are stored unencrypted. Set it to 64 hex characters (openssl rand -hex 32).');
}

// Alert sounds used to be one set shared by every streamer. Move those files
// into their owner's folder before anything serves sounds; later boots find
// nothing to move.
try {
  require('./services/customSounds').migrateLegacySounds({
    ownerExists: (id) => !!db.getStreamerById(id),
  });
} catch (e) {
  console.error('[Sounds] Legacy sound migration failed:', e.message);
}

// "Remove server" used to leave the server's watchers behind, and they kept
// posting there. Removing a server now takes them along; this clears what
// older removals left (later boots find nothing).
try {
  const { total, byTable } = db.deleteOrphanWatchers();
  if (total > 0) {
    const detail = Object.entries(byTable).filter(([, n]) => n > 0).map(([table, n]) => `${table}=${n}`).join(', ');
    console.log(`[DB] Removed ${total} watchers of servers their streamer no longer has (${detail})`);
  }
} catch (e) {
  console.error('[DB] Orphaned watcher cleanup failed:', e.message);
}

// At boot: the website and everything that does not need Discord (overlay
// alerts, the Twitch chat bot, sponsors, giveaways, housekeeping), so Discord
// being slow or down never keeps the site down.
function startWithoutDiscord() {
  server.start();

  const { eventSubManager } = require('./services/eventsub');
  const { streamElementsManager } = require('./services/streamelements');

  // Start overlay event sources
  eventSubManager.startAll();
  streamElementsManager.startAll();

  const { chatManager } = require('./services/twitchChat');
  chatManager.startAll();

  const { timedNotificationManager } = require('./services/timedNotifications');
  timedNotificationManager.startAll();

  require('./services/giveawayManager').init();

  // Multistream runs only once the relay is configured: then, finish any
  // go-live a previous restart interrupted, and from then on check the relay
  // every minute (services/multistreamSessions.js).
  if (config.multistream.enabled) {
    require('./services/youtubeBroadcast')
      .reconcileActiveBroadcasts()
      .catch((e) => console.error('[ytBroadcast] reconcile error:', e.message))
      .finally(() => require('./services/multistreamSessions').sessions().startChecks());
  }

  console.log('[YT Chat] YouTube Live Chat manager ready (starts when streams go live)');

  startHousekeeping();
}

function startHousekeeping() {
  // Clean up old moderation logs (every 6 hours)
  setInterval(() => { try { db.cleanupOldModLogs(); } catch (e) {} }, 6 * 60 * 60 * 1000);
  try { db.cleanupOldModLogs(); } catch (e) {}

  // Clean up old overlay events (every 6 hours)
  setInterval(() => { try { db.cleanupOldOverlayEvents(); } catch (e) {} }, 6 * 60 * 60 * 1000);
  db.cleanupOldOverlayEvents();

  // Donation history keeps 1 year; PayPal tips waiting for capture keep 24 hours (every 24 hours).
  // Before old pending tips are deleted, tips PayPal captured that were never recorded are recovered.
  const cleanupDonations = async () => {
    try { db.cleanupOldDonations(); } catch (e) {}
    try { await require('./routes/tip').reconcilePendingTips(); } catch (e) { console.error('[Tip] Reconcile error:', e.message); }
    try { db.cleanupOldPendingTips(); } catch (e) {}
  };
  setInterval(cleanupDonations, 24 * 60 * 60 * 1000);
  cleanupDonations();

  // Clean up old bridge logs (every 6 hours)
  setInterval(() => { try { db.cleanupOldBridgeLogs(); } catch (e) {} }, 6 * 60 * 60 * 1000);
  db.cleanupOldBridgeLogs();
  setInterval(() => { try { db.cleanupOldBridgeBugReports(); } catch (e) {} }, 6 * 60 * 60 * 1000);
  db.cleanupOldBridgeBugReports();

  // Clean up old notifications (every 24 hours)
  setInterval(() => { try { db.cleanupOldNotifications(); } catch (e) {} }, 24 * 60 * 60 * 1000);
  db.cleanupOldNotifications();

  // Nightly copy of the database, kept 7 days (services/backups.js), made without
  // pausing the app. Skipped when the copy would leave the data volume with less
  // than 200 MB free.
  require('./services/backups').scheduleNightlyBackups({
    backup: (file) => db.backupInto(file),
    databaseFile: db.db.name,
  });
}

// Once Discord is ready: what posts to or reads from Discord.
async function startWithDiscord() {
  console.log(`Bot online as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);
  console.log(`${db.getAllStreamers().length} registered streamers`);

  // Register slash commands (a failure is logged; the commands Discord already has keep working)
  await commands.registerCommands();
  commands.start();

  // Start welcome listener
  welcome.start();

  // Start all pollers (they post to Discord)
  pollers.startAll();

  console.log('All systems running');
}

try {
  startWithoutDiscord();
} catch (error) {
  console.error(`Startup error: ${error.message}`);
  process.exit(1);
}

let discordLogin = null; // the login and its retries (services/discordLogin.js)

if (config.discord.disabled) {
  console.warn('[Discord] DISCORD_DISABLED=1: the Discord bot stays offline (no slash commands, welcome messages or pollers). For development and CI only.');
} else {
  // 'ready' still fires in discord.js v14 but is deprecated and will be dropped
  // in v15; 'clientReady' is emitted alongside it today.
  client.once('clientReady', () => {
    startWithDiscord().catch((error) => {
      console.error(`Startup error: ${error.message}`);
      process.exit(1);
    });
  });

  // Only the bot needs Discord: a failed login is tried again (30 s, doubling up
  // to every 10 minutes) while the site and everything else keep running; a
  // token Discord refuses is logged loudly and not retried.
  discordLogin = startDiscordLogin({ client, token: config.discord.token });
}

// Handle bot joining a new guild
client.on('guildCreate', (guild) => {
  console.log(`[Guild] Joined: ${guild.name} (${guild.id})`);
  // Nothing is recorded here: a streamer claims the server from the dashboard,
  // which requires Manage Server in it.
});

// Handle bot being removed from a guild
client.on('guildDelete', (guild) => {
  console.log(`[Guild] Removed from: ${guild.name} (${guild.id})`);
});

// Graceful shutdown (SIGTERM on a deploy or restart, SIGINT on Ctrl-C): stop
// taking requests, end the overlay event streams, let the requests in progress
// finish (up to 10 s), stop what talks to Twitch, YouTube and Discord, close
// the database, exit 0.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal}: finishing the requests in progress (up to 10 s)`);

  try {
    const unfinished = await server.stop({ timeoutMs: 10_000 });
    if (unfinished > 0) console.warn(`[Shutdown] ${unfinished} request(s) had not finished after 10 s and were cut off`);
  } catch (e) {
    console.error(`[Shutdown] Web server: ${e.message}`);
  }

  const stop = (name, fn) => {
    try { fn(); } catch (e) { console.error(`[Shutdown] ${name}: ${e.message}`); }
  };
  stop('Pollers', () => pollers.stopAll());
  stop('Twitch chat', () => require('./services/twitchChat').chatManager.stopAll());
  stop('EventSub', () => require('./services/eventsub').eventSubManager.stopAll());
  stop('StreamElements', () => require('./services/streamelements').streamElementsManager.stopAll());
  stop('YouTube chat', () => require('./services/youtubeLiveChat').youtubeChatManager.stopAll());
  stop('Sponsor rotations', () => require('./services/timedNotifications').timedNotificationManager.stopAll());
  if (config.multistream.enabled) stop('Multistream checks', () => require('./services/multistreamSessions').sessions().stopAll());
  stop('Discord login retry', () => { if (discordLogin) discordLogin.stop(); });
  try {
    // At most 2 s for Discord to be told the bot is going offline.
    await Promise.race([client.destroy(), new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
  } catch (e) {
    console.error(`[Shutdown] Discord: ${e.message}`);
  }
  stop('Database', () => db.closeDb());

  console.log('[Shutdown] Done');
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
