# Project structure

The full file map, moved out of CLAUDE.md on 2026-11-28; a file added or renamed gets its line here.

```
src/
├── index.js              # Entry — web server + non-Discord managers at boot, Discord parts on ready, graceful shutdown
├── config.js             # Env vars, intervals, limits (the tier table is legacy: every tier is free and unlimited)
├── adminAccess.js        # Who is an admin: Discord user ids (the built-in one + ADMIN_DISCORD_IDS), never names
├── db.js                 # SQLite schema, migrations (one-time data migrations via _runOnce), seeds, all queries; seals/opens stored tokens, stores session ids hashed
├── server.js             # Express app + middleware (rate limits, body parsers, session (and the coaching viewer, req.viewer), CSRF, language, static files) + the 410 rule for the retired Racing API paths (`RETIRED_RACING_API`) and the `/racing*` and `/tracks*` redirect to `/`
├── bodyParsers.js        # Body limits: 100 kb, except the routes listed in LARGE_BODY_ROUTES
├── csrf.js               # CSRF check for POST/PUT/PATCH/DELETE: Origin + per-session token; CSRF_EXEMPT lists the routes that skip the Origin check
├── clientIp.js           # The visitor's address for the rate limits : CF-Connecting-IP when the request comes from Cloudflare's published ranges (CLOUDFLARE_RANGES), else req.ip
├── errorHandler.js       # Last middleware: logs the error (route pattern, never a token from the URL), answers a generic page or JSON, never a stack
├── health.js             # GET /health (SELECT 1)
├── httpDrain.js          # Graceful stop: tracks requests, ends SSE streams, waits up to 10 s
├── discord.js            # Discord client + the one place that posts (fetchGuildChannel, sendToGuildChannel, sendNotification, sendDirectMessage) + embed helpers (recap, digest, milestone) + coaching's member and invite checks (isGuildMember, fetchInvite, guildName) + the coaching rooms' calls (listCategories, checkCategory, createRole, createVoiceChannel, fetchAllMessages, downloadAttachment, hasMessageContent)
├── i18n.js               # Translation helper — t(), SUPPORTED_LANGS, fromAcceptLanguage() (unused); see docs/features/i18n.md
├── commands.js           # Slash commands (/link hands out a signed URL)
├── welcome.js            # Welcome message listener
├── locales/              # Translation files (en, pt, es, fr, de, zh, ja)
├── pollers/
│   ├── manager.js        # Orchestrator: starts and stops the pollers, each wrapped in exclusiveRun.js
│   ├── exclusiveRun.js   # A tick is skipped while the poller's previous run is still going
│   ├── twitchLive.js     # 60s — go-live posts and recaps (the stream is over after 2 empty polls in a row); also asks about every enabled streamer's own channel, for Tracking
│   ├── milestones.js     # Follower/subscriber milestone planning (pure); checked when a stream starts
│   ├── twitchClips.js    # 5min
│   ├── youtubeFeed.js    # 5min — RSS, works without an API key
│   ├── youtubeLive.js    # 2min — needs YOUTUBE_API_KEY
│   ├── weeklyDigest.js   # 15-min tick; posts in the Monday 09:00 UTC hour, up to 4 tries
│   └── subSync.js        # 10min — subscriber role sync
├── services/
│   ├── twitch.js         # Twitch Helix API (10 s timeouts, getStreams in batches of 100, getFollowAge) + broadcaster/bot token refresh
│   ├── twitchLogin.js    # Normalises a typed or pasted Twitch channel name
│   ├── youtube.js        # YouTube API (batched videos.list, an hour's pause when the quota is spent, Shorts ≤ 180 s) + RSS + Live Chat API + channel resolver + bot token refresh
│   ├── spotify.js        # Spotify Web API — currently playing track + token refresh
│   ├── eventsub.js       # Twitch EventSub WebSocket (per-streamer connections: one session socket each, 10-minute message_id dedupe)
│   ├── messageDedupe.js  # The message-id memory eventsub.js uses
│   ├── twitchChat.js     # Shared tmi.js chatbot — single connection, joins all enabled channels
│   ├── chatDispatcher.js # Everything the bot posts: 20 msgs/30 s bot-wide (BOT_CHAT_RATE_LIMIT), 1.5 s per channel, priorities, merged thank-yous
│   ├── chatTemplate.js   # Fills thank-you templates in one pass; viewer text can never start a command
│   ├── chatCommands.js   # Rules for custom !commands (name, response, cooldown 5–3600 s)
│   ├── chatModeration.js # Banned words, link protection, caps/emote/symbol/repetition filters, escalation, !permit/!slow, raid protection
│   ├── chatFilters.js    # Pure text checks behind the filters (Twitch and YouTube)
│   ├── safePattern.js    # Validates a regex banned word and tests messages against it at bounded cost
│   ├── regexBudget.js    # Per-streamer time budget for regex banned words
│   ├── builtinCommands.js # 13 built-in chat commands — followage, 8ball, rps, roast, etc.
│   ├── youtubeLiveChat.js # YouTube Live Chat poller during live streams
│   ├── youtubeModeration.js # YouTube chat moderation (the same filters as Twitch)
│   ├── giveawayManager.js # Chat-keyword giveaways: start, close, pick (once), re-draw
│   ├── timedNotifications.js # Sponsor image rotation per-streamer
│   ├── overlayBus.js     # EventEmitter singleton — routes events to overlay SSE + chat
│   ├── overlayConfig.js  # buildOverlayConfig(): what the OBS overlay is told about a streamer's settings
│   ├── overlayDesign.js  # The builder's save schema (FIELD_SPECS), EVENT_DEFAULTS, validateOverlayDesign()
│   ├── alertStyles.js    # The alert looks for the server, read from the registry (public/overlay/objects/kit.js + styles/): private looks (donation-c1), default looks, galleries, families, sounds, fonts
│   ├── alertStyleBundle.js # The family files joined into /overlay/objects/styles.css and styles.js, read once, with a version for ?v=
│   ├── overlayPresence.js # How many alert overlays (streams opened with ?source=alerts) are open per streamer: whether the overlay is open in OBS
│   ├── overlaySettings.js # What a save on /dashboard/overlay stores (toggles, durations, volume)
│   ├── customSounds.js   # Per-streamer alert sounds: data/sounds/<streamerId>/<type>.mp3, their URLs, the legacy migration
│   ├── uploadValidation.js # First-bytes checks for uploads (images, sounds) and reward media types
│   ├── multistreamRelay.js   # MediaMTX HTTP API client (Basic auth) — see docs/features/multistream.md
│   ├── multistreamSessions.js # Multistream go-live / delayed stop / minute relay check, one operation at a time per stream key
│   ├── multistreamAuth.js    # Who may publish, read and use the API on the relay (MediaMTX authMethod: http)
│   ├── youtubeBroadcast.js   # YouTube Data API v3 broadcast lifecycle for multistream
│   ├── twitchRewards.js      # Channel Points Helix client — see docs/features/channel-point-rewards.md
│   ├── redemptionDispatcher.js # Channel point redemption flow
│   ├── tipCapture.js     # Turns PayPal's capture into a donation (or a refusal); reconciles captures that were never recorded
│   ├── donationSettings.js # Server-side rules for the tip page settings and tip goals; errorMessage() maps ?error codes to t() keys
│   ├── tipSpeech.js      # Tips read aloud: whether a tip is read (speechDecision), the cleaned line (prepareSpeech), the spoken amount; pure
│   ├── tipVoice.js       # Tips read aloud: announceWithVoice() (gates, limits, the voice, then the alert; one tip at a time per streamer), testVoice(), the hourly file cleanup
│   ├── elevenLabs.js     # ElevenLabs client: synthesize() (15 s deadline) and remainingCredits() (read at most every 10 min); the key never leaves the server
│   ├── ttsVoices.js      # The curated voices per language with their preview URLs (public/tts/previews/); defaultVoice(), isVoice()
│   ├── ttsSettings.js    # What a save of the "Read tips aloud" section stores (checked and clamped), the error and status texts
│   ├── tipGoals.js       # Tip goal progress — recordDonation() from PayPal tips, broadcasts on `tipgoal:<id>`
│   ├── goalPeriods.js    # Tracking: the window a follower or sub goal counts in (lifetime, calendar or rolling year/month/week/day, hours) in the goal's IANA time zone, rollover times; pure
│   ├── trackingGoals.js  # Tracking: the follower and sub goals — start, edit, nudge, end, counting from the record or Twitch's total, calendar rollover, hours expiry, read-backs, tests, broadcast on `trackgoal:<id>:<kind>`, the minute tick
│   ├── trackers.js       # Tracking: the six trackers' last values (`tracker_values`) fed by events and tips, the top tipper this stream, broadcast on `tracker:<id>`
│   ├── backups.js        # Nightly copy to data/backups/bot-YYYY-MM-DD.db (03:30 UTC, SQLite backup API), kept 7 days
│   ├── storageQuota.js   # Upload guard: 200 MB must stay free on data/, 250 MB of media per streamer
│   ├── userContentHeaders.js # Headers for uploaded files served from data/ (sandbox CSP, nosniff, attachment)
│   ├── discordGuards.js  # Who may claim a server; which channels and sub roles a server's settings may use; welcome cap; the bot invite's permissions
│   ├── discordLogin.js   # Discord bot login with retries (30 s doubling to 10 min); never stops the site
│   ├── linkSignature.js  # Signs and verifies the /link URLs (HMAC, 15 minutes)
│   ├── oauthState.js     # Random per-flow OAuth state in a short-lived cookie
│   ├── secretBox.js      # AES-256-GCM sealing of stored tokens (enc:v1:…)
│   ├── streamerAccess.js # A disabled account counts as logged out everywhere
│   ├── accountLifecycle.js # What Disable/Enable/Remove stop and restart (EventSub, Twitch and YouTube live chat, sponsor rotations), and twitchAccountChanged() when a streamer's linked Twitch account changes
│   ├── pageLookups.js    # Twitch/YouTube lookups for dashboard pages, each with one 3 s deadline
│   ├── channelInfoBackfill.js # Fills in missing channel pictures/names after the server page is sent, at most once a day per row
│   ├── dashboardCards.js # What each of the Twitch tab's working cards shows: buildCards() decides every card's state from the data gatherCards() (routes/dashboard.js) gathers, cardTexts() translates the status lines and counts; pure, no database
│   ├── dashboardSettings.js # The settings a working card saves one at a time (POST /dashboard/settings): the whitelist, how each is read and checked, its single-column writer, what it needs first, what follows
│   ├── pollRules.js      # Polls & predictions: Twitch's limits, the check of a template, a poll or prediction as the card, the bar and the bot see it (pure)
│   ├── twitchPolls.js    # Helix polls and predictions with the broadcaster token (one 15 s deadline per call); Twitch's refusals as the card's codes
│   ├── livePolls.js      # The running poll and prediction per streamer (EventSub, the card's buttons, a Twitch read), the bar's bus channel poll:<id>, the bot's announcements
│   ├── shoutouts.js      # !so for moderators and the raid shoutout: Twitch lookups kept 10 minutes, one shoutout a minute per person
│   ├── coaching.js       # Coaching rules (pure): weekly hours in the streamer's zone, the lengths (30 min to 5 h) with their default prices, the free starts (on :00/:30, today + 13 days, 1 h ahead), booking states, the payment deadline, bookable, input checks
│   ├── paypal.js         # The PayPal calls (token, create order, capture, read an order back; 15 s each), shared by routes/tip.js and the coaching payments
│   ├── coachingPayments.js # Coaching payments: start (a PayPal order with the streamer as payee), the return's capture and its verification (payee, amount, currency, booking, COMPLETED), late captures, expiry of unpaid bookings, stale orders; never touches tips
│   ├── coachingRooms.js  # Coaching rooms: a role and a private voice room per paid session in the streamer's Coaching category, Retry, restart-safe clean-up, the transcript (.txt DMed to viewer and coach, files re-uploaded) and the close 30 minutes after the end
│   ├── coachingTick.js   # The coaching minute tick: expire unpaid bookings, read stale orders back, lapse and close reschedules, finish half-made rooms, close rooms
│   ├── coachingBookings.js # Coaching bookings: request, accept (a paid length awaits payment, a free one is confirmed), decline, cancel, withdraw, the membership answer kept 30 s (isMember), the hourly invite check (one at a time per streamer), the card's data; Discord messages to both sides (failures recorded or logged, never thrown)
│   ├── coachingMessages.js # The coaching Discord messages' embeds (pure; typed text through escapeLinkText)
│   ├── inputLimits.js, testCooldown.js, issueAnalysis.js, chunk.js  # Clamps for typed numbers; one test-button cooldown per streamer; limits for AI analysis; list slicing
│   ├── agentTriage.js    # AI analysis of reported issues (needs ANTHROPIC_API_KEY; model TRIAGE_MODEL)
│   ├── sync.js           # Dev only: daily copy of production's data (SYNC_SOURCE_URL + SYNC_SECRET); production side is routes/sync.js
│   └── redemptionTemplates.js  # Pure formatChatTemplate helper (unit-tested)
├── routes/
│   ├── auth.js           # Discord + Twitch + YouTube + Spotify OAuth flows (random state per flow, broadcaster-token owner check), /link, the coaching viewer sign-in (/auth/coaching-signin, the callback's coaching branch, POST /auth/coaching-signout)
│   ├── overlay.js        # OBS overlay SSE endpoint + overlay HTML page + custom designs + the sound route (/overlay/sounds/:token/:type) + the Tracking sources (/overlay/goal/followers|subs/:token, /overlay/tracker/:tracker/:token, their streams and demos)
│   ├── dashboard.js      # Dashboard, account, guild config, stats, channel CRUD, overlay/chatbot/sound/sponsor/donation/redemption/giveaway settings, the Tracking page (/dashboard/tracking) and its JSON routes (/dashboard/api/tracking/*), issue reports, VTuber models
│   ├── polls.js          # The Polls & predictions card's JSON routes (templates, Twitch's buttons, the live view), mounted inside the dashboard router
│   ├── coachingDashboard.js # The streamer's coaching page (/dashboard/coaching, four tabs: Bookings, Schedule, Price, Connections) and /dashboard/api/coaching/* (settings with lengths, prices and the category, open, the Connections tab's PayPal save, accept/decline/cancel, Retry room), mounted inside the dashboard router
│   ├── tip.js            # Public donation page — PayPal Checkout flow (the decisions are in services/tipCapture.js)
│   ├── coaching.js       # The public coaching booking page /coaching/:username (four steps) and its JSON (state, book, cancel, pay, the PayPal return, which lands on My bookings)
│   ├── myBookings.js     # The viewer's My bookings page /my-bookings (every coach, standalone) and GET /my-bookings/state (JSON)
│   ├── api.js            # API endpoints
│   ├── vtuber.js         # The VTuber OBS source (/vtuber/:token) and the bundled models
│   ├── sync.js           # Dev sync: production serves GET /sync/backup to a caller with SYNC_SECRET; development triggers it
│   ├── admin.js          # Admin panel: users (Disable/Enable/Remove), tiers, issues, test posts
│   ├── multistream.js    # Multistream page (dashboardRouter) + the relay's auth and webhooks (apiRouter), each mounted once
│   └── payment.js        # PayPal subscriptions (legacy pricing pages)
└── views/                # EJS templates — header.ejs (global layout; includes csrf.ejs), dashboard.ejs (platform-tabbed; its Twitch tab includes `cards/*.ejs`, one partial per working card plus `_style` and `_icons`), guild-config.ejs, overlay-config.ejs, overlay-builder.ejs, chatbot-config.ejs, mod-log.ejs, donation-settings.ejs, donation-history.ejs, redemptions-config.ejs, giveaways-config.ejs, timed-notifications.ejs, tracking.ejs, coaching-dashboard.ejs, multistream.ejs, tip.ejs, coaching.ejs (the public booking page, four steps; standalone like tip.ejs), my-bookings.ejs (the viewer's My bookings page; standalone), youtube-chatbot-config.ejs, account.ejs, report-issue.ejs, tutorial.ejs, link-result.ejs, error.ejs, csrf.ejs, plus auth/admin views
public/
├── js/csrf.js            # CSRF client: adds _csrf to POST forms and X-CSRF-Token to same-origin unsafe fetch()/XMLHttpRequest
├── js/dashboard-cards.js, dashboard-cards-core.js  # The Twitch tab's working cards: the page script (switches save as they change, status lines, pop-up editors, test buttons, giveaway panel, packing) and its pure helpers (dual-exported, tested in tests/dashboardCardsCore.test.js); texts from window.ATLETA_CARD_TEXTS
├── tts/previews/        # One recorded preview per tip voice and language: <voiceId>.<lang>.<sha256-8>.mp3, cached a year (docs/features/tip-tts.md)
├── js/builder-styles-core.js  # The Overlay Builder's rules without the page: a card's tabs, the look gallery and sound lists for one alert, the look's controls, the loop timings, the place summary (pure, dual-exported, tests/builderStylesCore.test.js)
├── js/builder-cards.js  # The Overlay Builder's alert cards (each looping its look), the edit window with its tabs, Done/Reset/Test, the stage and the free drag (dual-exported, tests/builderCards.test.js); built on the page's inline script in views/overlay-builder.ejs and on the files the OBS overlay uses (objects/kit.js, placement.js)
├── js/tracking-page.js   # The Tracking page's script: goal forms, nudge, tests, tracker switches and colours, previews by postMessage; texts from window.TRACKING_TEXTS
├── js/dashboard-tracking.js # The Tracking card: the goal bars, the goal pop-up with its live preview, the trackers' switches, tests and links; built on window.ATLETA_CARD_UI
├── js/dashboard-polls.js # The Polls & predictions card: the live panel (with the bar's model), the template pop-up, the chat texts; built on window.ATLETA_CARD_UI (dashboard-cards.js)
├── js/my-bookings.js     # The My bookings page's script: the viewer's bookings across coaches (pay, withdraw, reschedule panel, room, refund lines); texts from window.MYBOOKINGS_TEXTS
├── js/coaching-core.js, coaching-page.js # The coaching booking page's script and its pure helpers (days and times in the viewer's zone; dual-exported, tests/coachingCore.test.js); texts from window.COACHING_TEXTS
├── js/coaching-dashboard.js, dashboard-coaching.js # The streamer's coaching page (schedule, hours; texts from window.COACHING_DASHBOARD_TEXTS) and the Coaching card (built on window.ATLETA_CARD_UI)
├── screenshots/          # Setup Guide images: /tutorial loads /screenshots/step-*.png; shipped in the production image (about 11 MB)
└── overlay/
    ├── overlay.css       # Alert card styles — centered cards with per-event themes, full-screen effects
    ├── overlay.js        # SSE client, event queue, card rendering, placement (applyPlacement), custom design application, redemption playback
    ├── placement.js      # Reads a saved design's position and width — shared by the OBS overlay and the builder preview
    ├── objects/          # The alert looks: index.js (today's five objects + the style map: the C1, as andre_vilela_'s private `donation-c1` and `donation-c1-channel`, any streamer's, with their Twitch name on the rear window) + objects.css, kit.js (what every look shares), styles/<family>.js + .css (one pair per family, 26 families, joined for the pages), sounds/<family>/<key>.<hash>.mp3 + <key>.2.<hash>.mp3 (each look sound's two recordings) and sounds/manifest.js (their table, written by scripts/look-sounds.js); every class namespaced .o-*
    ├── fx.js, fx.css     # The looks' five screen effects (smoke, checker, speed, sparks, champagne), for the OBS overlay and the builder preview
    ├── sponsors.js       # Sponsor overlay — independent OBS browser source
    ├── tipVoiceTiming.js # How long a tip's alert stays while its voice is read (voiceHoldMs; dual-exported)
    ├── goal.js, goal.css # Tip goal progress bar — independent OBS browser source at /overlay/goal/TOKEN
    ├── tracking.js, tracking.css # Tracking sources: the follower and sub goal bars (/overlay/goal/followers|subs/TOKEN, the tip goal's card) and the six trackers (/overlay/tracker/<tracker>/TOKEN), plus their demos; dual-exported for tests/trackingClient.test.js
    ├── poll.js, poll.css, pollModel.js # Poll and prediction bar — independent OBS browser source at /overlay/poll/TOKEN; pollModel.js (what it shows) is shared with the card
    └── iracing/          # The Twitch chat overlay at /overlay/iracing/chat/<token> (the old URL, kept so existing OBS sources work; chat.js + chat.css + shared.js/css); every other type answers 404
tests/                    # Cross-cutting unit suites (*.test.js) + two Playwright specs (*.spec.js); module tests sit next to their module as src/**/<name>.test.js
scripts/                  # decrypt-tokens.js: emergency rollback only, after TOKEN_ENCRYPTION_KEY is set (turns the sealed tokens back into plain text, in place; docs/operations/deploy.md). test-recap.js: forces a stream recap for one streamer (manual test). locale-keys.js: adds texts to the seven locale files, or sets one language's texts, line by line (the files keep their layout). look-sounds.js: writes public/overlay/objects/sounds/manifest.js from the looks' recordings (`--check` says whether it is current; docs/features/look-sounds.md)
data/                     # bot.db, backups/ (nightly copies), sounds/<streamerId>/ (+ _archive/), tts/<streamerId>/ (tip voices, removed after an hour), sponsors/<streamerId>/, redemptions/<streamerId>/, vtuber-models/<streamerId>/, avatars/, issues/  (persistent volume)
docs/
├── features/             # Per-feature deep dives — see "Key Architecture" below for which file covers what (channel-point-rewards, multistream, i18n, look-sounds, tip-tts, tracking, coaching)
├── operations/           # deploy.md (Railway settings, secrets rollout, rollback, log lines), backup-restore.md
├── multistream.md, multistream-relay-setup.md  # Operator/resume docs for the multistream relay
├── security-todo.md
└── superpowers/          # Historical plans and specs
```
