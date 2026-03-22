# Vilela Notifications

Discord bot that sends notifications when **andre_vilela_** goes live on Twitch, gets new clips, goes live on YouTube, or uploads a new video.

## Features

| Notification | Source | Check Interval |
|---|---|---|
| Twitch live | Twitch Helix API | 60 seconds |
| New Twitch clip | Twitch Helix API | 5 minutes |
| YouTube live | YouTube Data API + RSS | 2 minutes |
| New YouTube video | YouTube RSS feed | 5 minutes |

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it (e.g., "Vilela Notifications")
3. Go to **Bot** tab → click **Reset Token** → copy the token (this is your `DISCORD_TOKEN`)
4. Under **Privileged Gateway Intents**, you don't need any special intents
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Embed Links`
6. Copy the generated URL and open it to invite the bot to your server
7. In Discord, right-click the channel where you want notifications → **Copy Channel ID** (enable Developer Mode in Settings → Advanced if you don't see this). This is your `DISCORD_CHANNEL_ID`

### 2. Create a Twitch Application

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console)
2. Click **Register Your Application**
3. Set:
   - Name: anything unique (e.g., "vilela-notifications")
   - OAuth Redirect URLs: `http://localhost`
   - Category: Chat Bot
4. Click **Manage** on your app → copy the **Client ID** (`TWITCH_CLIENT_ID`)
5. Click **New Secret** → copy it (`TWITCH_CLIENT_SECRET`)

### 3. Get a YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Go to **APIs & Services** → **Enable APIs** → search for **YouTube Data API v3** → **Enable**
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **API Key**
5. Copy the key (`YOUTUBE_API_KEY`)
6. (Recommended) Click **Edit API Key** → under **API restrictions**, restrict it to YouTube Data API v3 only

### 4. Find the YouTube Channel ID

1. Go to the YouTube channel page
2. Click on **More** (or view page source)
3. The Channel ID looks like `UCxxxxxxxxxxxxxxxxxxxxxxxxx`
4. Or use a tool like [Comment Picker](https://commentpicker.com/youtube-channel-id.php)

### 5. Configure Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=123456789012345678
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
TWITCH_USERNAME=andre_vilela_
YOUTUBE_CHANNEL_ID=UCxxxxxxxxxxxxxxxxxxxxxxxx
YOUTUBE_API_KEY=your_youtube_api_key
```

### 6. Run Locally

```bash
npm install
npm run dev
```

The bot should log `Bot online as ...` and start polling.

## Deploy to Railway

1. Push this code to a GitHub repository
2. Go to [Railway](https://railway.app/) and create a new project
3. Click **Deploy from GitHub repo** and select your repository
4. Railway will auto-detect the Dockerfile and build it
5. Go to **Variables** tab and add all the environment variables from your `.env` file
6. The bot will deploy and start automatically

That's it — the bot will stay online 24/7 on Railway.

## How It Works

The bot polls each platform at regular intervals and sends a rich embed message to your Discord channel when it detects new content. It stores state in a JSON file to avoid sending duplicate notifications.

On startup, the bot checks the current state of all platforms to avoid false notifications after a restart/redeploy.
