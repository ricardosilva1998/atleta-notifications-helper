const config = require('./config');
const db = require('./db');
const { client } = require('./discord');
const server = require('./server');
const commands = require('./commands');
const welcome = require('./welcome');
const { startAll } = require('./pollers/manager');

// Long-running server: a single unhandled rejection / uncaught exception must
// not take the process down. Log loudly and keep going — Railway will still
// crash-restart on a real fatal, this just buys us a recovery window.
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection:', err && err.stack || err);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack || err);
});

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

// 'ready' still fires in discord.js v14 but is deprecated and will be dropped
// in v15; 'clientReady' is emitted alongside it today.
client.once('clientReady', async () => {
  console.log(`Bot online as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);
  console.log(`${db.getAllStreamers().length} registered streamers`);

  try {
    // Register slash commands
    await commands.registerCommands();
    commands.start();

    // Start welcome listener
    welcome.start();

    // Start all pollers
    startAll();

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

    // Finish any multistream go-live a previous restart interrupted.
    require('./services/youtubeBroadcast')
      .reconcileActiveBroadcasts()
      .catch((e) => console.error('[ytBroadcast] reconcile error:', e.message));

    console.log('[YT Chat] YouTube Live Chat manager ready (starts when streams go live)');

    // Start web dashboard
    server.start();

    // Clean up old moderation logs (every 6 hours)
    setInterval(() => {
      try {
        const db = require('./db');
        db.cleanupOldModLogs();
      } catch (e) {}
    }, 6 * 60 * 60 * 1000);
    try { const db = require('./db'); db.cleanupOldModLogs(); } catch (e) {}

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

    console.log('All systems running');
  } catch (error) {
    console.error(`Startup error: ${error.message}`);
    process.exit(1);
  }
});

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

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  db.closeDb();
  client.destroy();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

client.login(config.discord.token);
