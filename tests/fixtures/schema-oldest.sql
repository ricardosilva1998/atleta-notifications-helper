-- Schema only (no rows) of src/db.js at 5a9ac56 (2026-03-23): the first one with discord_user_id, so the oldest schema that today's db.js migrates in place (a4f8167, the one before, is dropped whole by "Migration 1").
CREATE TABLE streamers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT UNIQUE NOT NULL,
    discord_username TEXT NOT NULL,
    discord_display_name TEXT,
    discord_avatar TEXT,
    twitch_user_id TEXT UNIQUE,
    twitch_username TEXT,
    twitch_display_name TEXT,
    broadcaster_access_token TEXT,
    broadcaster_refresh_token TEXT,
    broadcaster_token_expires_at INTEGER DEFAULT 0,
    youtube_channel_id TEXT,
    youtube_api_key TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE guilds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
    guild_name TEXT,
    twitch_live_channel_id TEXT,
    twitch_clips_channel_id TEXT,
    youtube_channel_id TEXT,
    welcome_channel_id TEXT,
    sub_role_id TEXT,
    welcome_message TEXT,
    twitch_live_enabled INTEGER DEFAULT 1,
    twitch_clips_enabled INTEGER DEFAULT 1,
    youtube_enabled INTEGER DEFAULT 0,
    welcome_enabled INTEGER DEFAULT 0,
    sub_sync_enabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(guild_id, streamer_id)
  );

CREATE TABLE poller_state (
    streamer_id INTEGER PRIMARY KEY REFERENCES streamers(id) ON DELETE CASCADE,
    twitch_is_live INTEGER DEFAULT 0,
    twitch_broadcaster_id TEXT,
    last_clip_created_at TEXT,
    known_video_ids TEXT DEFAULT '[]',
    youtube_is_live INTEGER DEFAULT 0,
    youtube_live_video_id TEXT
  );

CREATE TABLE user_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    twitch_user_id TEXT NOT NULL,
    twitch_username TEXT NOT NULL,
    UNIQUE(streamer_id, discord_user_id)
  );

CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    streamer_id INTEGER NOT NULL REFERENCES streamers(id),
    expires_at INTEGER NOT NULL
  );
