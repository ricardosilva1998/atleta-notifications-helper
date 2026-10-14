# Atleta Notifications Helper

A self-service Discord notification bot for streamers. Any streamer can sign up, add the bot to their Discord, and configure notifications — no code changes needed. The same site also hosts a Twitch chat bot, OBS alert overlays and a racing product (the Atleta Racing app for iRacing); `CLAUDE.md` describes the whole platform and its conventions.

## Features

| Feature | Source | Interval |
|---|---|---|
| Twitch live notifications | Twitch Helix API | 60s |
| Twitch clip notifications | Twitch Helix API | 5min |
| YouTube video notifications | YouTube RSS feed | 5min |
| YouTube live notifications | YouTube Data API (needs `YOUTUBE_API_KEY`) | 2min |
| Welcome messages | Discord event | Instant |
| Subscriber role sync | Twitch Subscriptions API | 10min |

## How It Works

1. Streamer logs in with Discord at the web dashboard and connects their Twitch account
2. Adds the bot to their Discord server
3. Configures which channels get which notifications
4. Bot starts monitoring and sending notifications automatically

## Setup

### 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a new application
3. Go to **Bot** tab → **Reset Token** → copy it (`DISCORD_TOKEN`)
4. Enable **Server Members Intent** under Privileged Gateway Intents
5. Go to **OAuth2** → note the **Client ID** (`DISCORD_CLIENT_ID`) and the **Client Secret** (`DISCORD_CLIENT_SECRET`), and add the redirect URL `https://YOUR_APP_URL/auth/login/callback` (the streamers' Discord login)

### 2. Create a Twitch Application

1. Go to [dev.twitch.tv/console](https://dev.twitch.tv/console)
2. Register a new application
3. Set **Client Type** to **Confidential**
4. Copy **Client ID** (`TWITCH_CLIENT_ID`) and generate a **Client Secret** (`TWITCH_CLIENT_SECRET`)
5. Add OAuth Redirect URLs:
   - `https://YOUR_APP_URL/auth/twitch/callback`
   - `https://YOUR_APP_URL/auth/broadcaster/callback`
   - `https://YOUR_APP_URL/auth/link/callback`

### 3. Deploy to Railway

1. Push this repo to GitHub
2. Create a new project on [Railway](https://railway.app/)
3. Deploy from the GitHub repo (Railway builds the `Dockerfile`)
4. **Attach a Volume** mounted at `/app/data` (for SQLite persistence)
5. Add environment variables:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (required: the app does not start without them)
   - `APP_URL` (your Railway public URL, e.g., `https://your-app.up.railway.app`)
   - `TOKEN_ENCRYPTION_KEY`, `LINK_SIGNING_SECRET`, `CSRF_SECRET` (secrets a production site should set; each has a fallback, so the app starts without them)
   - Everything else is optional (`PORT` defaults to 3000). `.env.example` lists every variable with a comment, and `CLAUDE.md` ("Environment Variables") says what each one does.
6. Generate a public domain in Railway for the service

`docs/operations/deploy.md` has the Railway service settings (healthcheck, restart policy, backups) and the order to roll out the secrets.

### 4. Update the Redirect URLs

After you have your Railway URL, go back to the Discord and Twitch developer consoles and add the redirect URLs with your actual URL.

## Local Development

Use Node.js 24, the version the production image runs.

```bash
cp .env.example .env
# Fill in your credentials
npm install
npm run dev
```

To run the site without the Discord bot (development only: no Discord login, slash commands, welcome messages or pollers), set `DISCORD_DISABLED=1` in `.env`; `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are then not needed.

`npm test` does nothing. The unit tests (what CI runs) are started explicitly:

```bash
node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"
```

## Architecture

- **Backend:** Node.js 24 + Express + discord.js
- **Database:** SQLite (via better-sqlite3)
- **Frontend:** Server-rendered EJS templates
- **Hosting:** Railway with a persistent volume
