# Deploying and running production

Production is one Railway service ("Atleta Notifications PROD", environment `production`) built
from the `Dockerfile`, with a volume mounted at `/app/data` (the SQLite database, uploads and the
nightly copies in `data/backups/`). A push to `main` deploys it (about two minutes). Backups and
restores are in `backup-restore.md`; the multistream relay is a separate machine
(`../multistream-relay-setup.md`).

## Service settings

Set these in the Railway dashboard (service **Settings**). `railway.json` records the same values,
but Railway's documentation (read 2026-10-14) says Config as Code files stop being read on
2026-12-01 and that new services cannot opt in, so the dashboard is the source of truth.

| Setting | Value |
|---|---|
| Builder | Dockerfile |
| Start command | **none**. A custom one would override the Dockerfile's `CMD ["node", "src/index.js"]` |
| Healthcheck path / timeout | `/health` / 120 s (the deploy waits for `{"ok":true}`) |
| Restart policy | On Failure, 10 retries |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `15`. On SIGTERM the app finishes the requests in progress for up to 10 s, so Railway must wait longer than that before it kills the process |
| Backups | service → **Backups**: Daily and Weekly. The app's own nightly copies live on the same volume (see `backup-restore.md`) |
| Wait for CI | optional: a red `Server CI` run then blocks the deploy |

Good to know:

- The app exits 0 only after SIGTERM/SIGINT. Anything else (the port cannot be bound, a malformed
  `TOKEN_ENCRYPTION_KEY`, a missing required variable) exits 1, which On Failure restarts, up to 10
  times. `/health` is database-only, so a refused Discord token does not fail a deploy.
- Railway checks health only while a deploy is going live, and never runs two deployments on one
  volume, so every deploy has a short gap. Use an uptime monitor on `/health` for the rest.
- The development environment's daily `/sync` ends with `process.exit(0)`; under On Failure Railway
  does not restart that, so give development the Always policy if it uses `/sync`.

## Variables

Everything the code reads is listed in `.env.example` and in `CLAUDE.md` ("Environment Variables").
What production needs set:

| Variable | Set to | If missing |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters, in two steps (below). Never change or lose it | OAuth tokens stay unencrypted; one boot warning |
| `LINK_SIGNING_SECRET` | `openssl rand -hex 32` | a per-boot secret: `/link` links still open stop working at every restart |
| `CSRF_SECRET` | `openssl rand -hex 32` | a per-boot secret: after every restart each open dashboard tab must be reloaded before it can save |
| `BOT_TWITCH_TOKEN` | a token that also carries `moderator:manage:chat_settings` | raid protection and `!slow` stay inert (one warning per streamer per day) |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `15` | see the table above |
| `ELEVENLABS_API_KEY` | Atleta's ElevenLabs key (the owner's Creator plan; the same one the development `.env` holds). The key needs **text-to-speech** access **and** read access to **user** (the subscription, `GET /v1/user/subscription`): without the second the site credit floor silently stops applying (see `[TTS] Credits read failed` under the log lines) | tips are not read aloud: the Donations page says the feature is not available and the card has no switch |

Optional: `ADMIN_DISCORD_IDS`, `BOT_CHAT_RATE_LIMIT`, `ANTHROPIC_API_KEY` (+ `TRIAGE_MODEL`) for AI
analysis of reported issues; `TTS_CREDIT_FLOOR` (default 20000: tips stop being read while the ElevenLabs
account has fewer credits left) and `ELEVENLABS_TTS_MODEL` (default `eleven_multilingual_v2`; Portuguese always uses `eleven_turbo_v2_5`), best left unset. `YOUTUBE_API_KEY` is **not set** in production, so YouTube livestreams
are not detected and the YouTube chat bot never starts (uploads are still announced from RSS). Leave
`WEEKLY_DIGEST_INTERVAL` unset: an hourly value gives the weekly digest one try per week instead of
four. `DISCORD_DISABLED` must never be set.

Not read by any code any more, remove them when convenient: `GITHUB_TOKEN`, `GITHUB_REPO`,
`MULTISTREAM_KEY_SECRET`. `src/config.js` still reads `SESSION_SECRET` and `ADMIN_PASSWORD`, but nothing
uses them (sessions are random ids kept as hashes, and admin is decided by Discord id), so they can stay
or go.

## Rolling out `TOKEN_ENCRYPTION_KEY` (two steps)

1. **Deploy the release without the key.** Session ids are stored as hashes on the first boot
   (cookies stay valid, nobody is logged out); tokens stay as they are; one warning says the key is
   not set. Check the boot log (below) and that logging in, the dashboard and an overlay work.
   Going back to the older release at this point is possible, with these costs:
   - Everybody logs in once more: older code cannot match hashed session ids.
   - The four shared alert sounds (follow, subscription, bits, donation) stop playing for **every**
     streamer, not just streamer 13, until they are moved back. The first boot moved them into
     `data/sounds/13/`, and older code looks in the folder root, so every overlay falls back to the
     built-in sounds. Move them back inside the container (`railway ssh`; the braces need bash, so
     type `bash` first if you land in plain `sh`):
     `mv /app/data/sounds/13/{follow,subscription,bits,donation}.mp3 /app/data/sounds/`.
     The next boot of this release moves them into `13/` again.
   - Accounts switched off in Admin → Users work again (they can log in and their overlay links
     answer): older code did not lock a switched-off account out, it only stopped that account's
     notifications. After rolling forward, open Admin → Users and switch off again any that should
     be off.
   - The clean-up of orphaned watchers deleted rows for good (only a database copy brings them back).
2. **Take a fresh backup** (`backup-restore.md`). Then generate the key with `openssl rand -hex 32`,
   keep a copy in a password manager, and set `TOKEN_ENCRYPTION_KEY`. The variable change redeploys
   the same code; its boot encrypts every stored token. Expect `[DB] Encrypted N stored token(s) with
   TOKEN_ENCRYPTION_KEY`, no `cannot be decrypted` line, and no "not set" warning.

A malformed key stops the boot (exit 1) on purpose. With a different key, or none, encrypted tokens
read as "not connected" (they are not deleted, so the right key brings them back) and streamers
would have to connect Twitch, YouTube, Spotify and StreamElements again.

**Do not roll back to a release from before this one once the key is set.** Older code would send
the `enc:v1:` text to Twitch as if it were a token, the refresh would fail and the streamers' scopes
would be cleared, and the hashed session ids would log everyone out. Roll forward instead. If you
must go back: in the running container (`railway ssh`, from `/app`) run
`TOKEN_ENCRYPTION_KEY=<the key> node scripts/decrypt-tokens.js`, which turns the tokens back into
plain text and prints how many, then redeploy the older release straight away (everyone logs in
again). The other way back is the database copy from step 2 together with the old release
(everything written since is lost). Copies made before the key was set hold plaintext tokens until
they age out.

## Log lines worth knowing

First boot of the 2026-10 release (each appears once):

- `[DB] Stored N web session id(s) as hashes`
- `[DB] Encrypted N stored token(s) with TOKEN_ENCRYPTION_KEY` (step 2 above)
- `[Sounds] Moved shared <type>.mp3 to 13/<type>.mp3`, four times: the four sounds that used to play
  for every streamer now belong to streamer 13. `_archive/` instead of `13/` means streamer 13 does
  not exist (the files are kept in `data/sounds/_archive/`). The migration
  (`migrateLegacySounds`, called from `src/index.js`) can be deleted after this boot.
- `[DB] Removing orphaned watcher: ...` and `[DB] Removed N watchers of servers their streamer no
  longer has`: notifications of servers a streamer no longer has. Irreversible, hence the backup.
- `[DB] Switched Channel Point Rewards on for N streamer(s) with an enabled reward`
- `[DB] Moved N alert duration(s) from the earlier defaults to the longer ones`: on the boot of the
  follow-up that made alerts stay longer (once); a duration a streamer had changed is not counted.
- No `[DB migration]` line at all (CI fails on one on a fresh database).

Trouble:

- `[Discord] LOGIN REFUSED ...`: Discord rejected `DISCORD_TOKEN` or the bot's intents. The site keeps
  running, but Discord posts, slash commands and welcome messages are off and the login is not retried.
  **After any change to the Discord token, read the boot log for this line.**
- `[DB] ... cannot be decrypted` or `TOKEN_ENCRYPTION_KEY is not set`: see above.
- `[CSRF] Refused ...`: a request was turned away. After a deploy, open pages sending an old token are
  expected; a Bridge call or other program that is refused needs an entry in `CSRF_EXEMPT` (`src/csrf.js`).
- `[Tip] Order ... not counted: <reason>`: a PayPal capture that did not pass the checks (nothing is
  announced; the money still reached the streamer).
- `[TTS] Streamer <id>: <code>`: a tip's voice (or a test) failed, at most once per streamer an hour (the settings
  page shows the last one). `no_key`: `ELEVENLABS_API_KEY` is not set. `credit_floor`: the account has fewer credits
  left than `TTS_CREDIT_FLOOR`, so nothing is read until ElevenLabs' monthly reset. `elevenlabs_401`: the key was
  refused (changed or deleted on ElevenLabs). `elevenlabs_429`: ElevenLabs is busy or the plan's concurrency is used
  up. `elevenlabs_timeout`: no audio within 15 s. A `4xx` for one voice: that library voice was withdrawn (replace it,
  `docs/features/tip-tts.md`). The alert still played, without its voice.
- `[TTS] Credits read failed: <status|failed>`: the hourly-at-most log of a failed read of the account's remaining credits
  (`GET /v1/user/subscription`, tried every 10 minutes). `401` or `403`: the key has no permission to read the user
  (subscription): give it **user** read access on ElevenLabs. `failed`: no answer in 10 s, no network or an unreadable
  answer; a `429` or `5xx` is ElevenLabs being busy. While credits cannot be read the site-wide credit floor
  (`TTS_CREDIT_FLOOR`) does **not** apply (tips are still read, bounded by the monthly limits), so fix it.
- `[TTS] Cleanup error: ...`: the hourly removal of the voice files older than an hour (`data/tts/`) failed.
- `[YouTube] ... invalid_grant`: the YouTube bot's refresh token was revoked or expired (a Google OAuth
  app in "Testing" mode expires it after 7 days); make a new `YOUTUBE_BOT_REFRESH_TOKEN`.
- `[SubSync]` logs one count line per streamer per cycle and one line per role given or taken, not one
  per linked viewer. To see who is linked, query `user_links`.
- Every icon missing on every page: the browser refused the icon library because the `integrity` hash in its
  `<script>` tag (`header.ejs`, `racing-pitwall.ejs`; unpkg, `lucide@1.57.0`) does not match the file. The
  version is pinned together with its hash, so only a change to the tag can cause it; nothing to do at deploy.

## First deploy of the 2026-10 stream fixes

Before:

1. No streamer is live.
2. The admin's `streamers.discord_user_id` is one of the admin ids (`src/adminAccess.js`); if not, set
   `ADMIN_DISCORD_IDS`.
3. A fresh database copy exists (the orphan clean-up and the new "Remove" delete rows for good): make
   it in the container and take a Railway volume backup too (`backup-restore.md`).
4. Admin → Users: a switched-off account loses the dashboard, its overlay links and its sessions; switch
   on the ones that should work.
5. The five main alerts take their saved position and width again (they were ignored). To see who has
   one: `SELECT streamer_id, event_type, card_position, card_custom_x, card_custom_y, card_width FROM
   overlay_designs WHERE event_type IN ('follow','subscription','bits','donation','raid') AND
   (card_position != 'top-center' OR card_custom_x IS NOT NULL OR card_width != 420);`
6. `LINK_SIGNING_SECRET` and `CSRF_SECRET` are set; `WEEKLY_DIGEST_INTERVAL` is not; the service
   settings above are applied.

After, and over the first days:

- `https://atletanotifications.com/health` answers `{"ok":true}`, and the boot log shows the lines
  above and no `[DB migration]` error.
- The first real tip fires its alert (the capture asks PayPal for the full order, which has not been
  exercised against the real service: a small test tip is worth it).
- `429` answers on `/api` should be rare. Rate limits now count per visitor address instead of per
  Cloudflare data centre, so visitors no longer share one counter. A burst of `429`s means the limits
  need a look. Railway's HTTP logs show them: `railway logs --http --status 429 --lines 100` (flags as
  in `railway logs --help`). The visitor's address is trusted from Cloudflare only for the address ranges
  listed in `CLOUDFLARE_RANGES` (`src/clientIp.js`, dated 2026-10-14): when Cloudflare publishes new ones
  (https://www.cloudflare.com/ips/), add them there, or visitors coming through them are counted as one
  shared Cloudflare address again.
- Once the release has settled, delete the hand-made copy `data/backups/pre-release.db`
  (`backup-restore.md`): it holds account tokens, and the nightly clean-up leaves it alone.
- `build-bridge.yml` (the "Build Atleta Bridge" workflow) runs when a push touches `bridge/**`,
  `bridge/CLAUDE.md` included, and this release changes that file. It publishes a new installer only
  when the version in `bridge/package.json` is new, but its "Add release notes" step rewrites the notes
  of the release for that version from the latest `bridge/` commits even when nothing is published. To
  ship a Bridge change to drivers, raise the version in `bridge/package.json` in the same push.

### What streamers see, and what they need to do

Need to do something:

- **Everyone:** a dashboard tab (or an OBS dock) that was open across the deploy needs one reload before
  it can save. OBS browser sources reload by themselves; no URL changes.
- **Custom alert sounds:** the four sounds that used to play for every streamer now belong to streamer 13.
  Every other streamer stops hearing them and gets the built-in racing sounds; one who wants their own
  sound uploads it under Overlay settings.
- **Channel point rewards:** anyone with an enabled reward sees the "Enable Channel Point Rewards" switch
  on (it was ignored before; switch it off to refund every redemption instead of playing it). Press
  "Sync from Twitch" once before editing a reward. A streamer's first reward switches the switch on.
- **Alert positions:** a streamer who had moved one of the five main alerts opens the builder once, checks
  "Size & Position" on each of those tabs and saves again if it is not where they want it. "Solid (no
  gradient)" now sticks; pick it again if it was chosen before.
- **Viewers:** `/link` messages from before the deploy stop working (links last 15 minutes now); they run
  `/link` again.
- **Sub sync:** open the server's Discord settings page. A yellow "Sub sync is paused here" box means the
  sub role has moderator-style permissions, is above the bot or is a managed role: fix it or pick another.
- **Twitch connections:** a streamer who sees "Reconnect Twitch" reconnects (it adds the permissions for
  follow and bits alerts and for `!followage`; the Channel Point Rewards page has its own reconnect notice
  for the rewards permission). Authorizing with another Twitch account than the linked one is refused with
  a banner naming the right one.
- **A different Twitch account later:** a streamer who links another Twitch account sees "Enable Sub Sync" and
  authorizes again; until then alerts, sub sync, `!followage`, the follow-age filter and rewards for the new
  channel are off.
- **Tip goals:** a goal in another currency than the tip page now shows a warning; use the same currency
  or PayPal tips never count toward it.

Will notice, nothing to do: the Multistream card is hidden until the relay exists; follow and new-sub
thank-yous arrive about five seconds after the alert and merge when several come at once; one alert and
one thank-you per gift sub; giveaways draw winners again; a test button works once every five seconds;
uploads stop at 250 MB per streamer; logout is a button; pages are in English until a
language is chosen; new Discord invites ask for six permissions instead of Administrator; Preview Alert works
for the giveaway winner and the three YouTube alerts; YouTube and giveaway cards fade out instead of vanishing,
and the giveaway card shows its party popper on both sides; saving the overlay settings mid-stream no longer
reconnects Twitch; saving the server page while the bot cannot see the server keeps the welcome channel and sub
role (and says so); a timed giveaway that ended while the app was down is drawn about 30 s after it starts; an
alert that was in flight when Twitch moved the connection is no longer lost, a connection that never gets its
welcome is replaced within about 15 s, and chat lines wait (up to a minute) while the bot reconnects; Gift Subs on
the dashboard counts every sub in a gift (the Subs tile can still include per-recipient rows logged before the
earlier gift fix, for up to 7 days); alerts stay on screen longer by default (follow 8 s; sub, bits, raid and
giveaway winner 10 s; donation 12 s; YouTube Super Chat 12 s, member 8 s, gift member 10 s; a duration a streamer
had changed stays), and the YouTube alerts' durations and switches on the overlay settings page are saved; a
Discord sub role that may mention @everyone syncs again.

## Dashboard working cards (Release B)

Before:

1. No streamer is live and no giveaway is open.
2. Nothing to migrate: this release changes no table or column. Going back to the previous release is a
   plain revert.

Checked before this release: no streamer with the overlay switch off had an overlay set up (no designs,
sounds, alerts, tips or giveaways), and no sponsor message was longer than 500 characters.

### What streamers see

- **Everyone:** a dashboard tab that was open across the deploy needs one reload.
- **The Twitch tab** is now ten working cards: their switches save as they move, and their short texts are
  edited in pop-ups. The sponsor messages page is reached from the Sponsor messages card.
- **The OBS overlay switch** now turns the alerts on stream on and off: an open OBS source with the switch
  off shows no alert at all, PayPal tip alerts and giveaway winner cards included (they used to show
  regardless).
- **Back:** the overlay settings page, the Overlay Builder, the Channel Point Rewards page and the tip goals
  on the donations page, with the settings saved before.

## Vilela's C1 donation alert

Run the checks and the switch inside the running service: open a shell with `railway ssh` and work from `/app`,
as `backup-restore.md` does for its copy in the container. The image has no `sqlite3` program (the `Dockerfile`
adds only `python3 make g++` to `node:24-slim`), so the commands below use Node and `better-sqlite3`, which the
app already ships, and take their SQL as the last argument. The read-only ones open `data/bot.db` with
`{ readonly: true }`, so they cannot change it.

Before:

1. Vilela (andre_vilela_) is not live.
2. Read only, in production: his `twitch_user_id` is `632557806` (the switch-on finds him by it). This prints
   one row with `twitch_username` `andre_vilela_` and the width and position of his donation design (note
   them: the C1 keeps them):

   ```bash
   cd /app && node -e "const D=require('better-sqlite3');console.log(JSON.stringify(new D('data/bot.db',{readonly:true}).prepare(process.argv[1]).all()))" "SELECT s.id, s.twitch_username, o.card_width, o.card_position, o.card_custom_x, o.card_custom_y FROM streamers s LEFT JOIN overlay_designs o ON o.streamer_id = s.id AND o.event_type = 'donation' WHERE s.twitch_user_id = '632557806'"
   ```

After the deploy:

- The boot log shows `[DB] Added style to overlay_designs` and, once,
  `[DB] The C1 donation alert is on for andre_vilela_`. Neither appears again on later boots.
- Read only: his donation design has `style = 'donation-c1'`, with the width and position noted above:

  ```bash
  cd /app && node -e "const D=require('better-sqlite3');console.log(JSON.stringify(new D('data/bot.db',{readonly:true}).prepare(process.argv[1]).all()))" "SELECT o.style, o.card_width, o.card_position, o.card_custom_x, o.card_custom_y FROM overlay_designs o JOIN streamers s ON s.id = o.streamer_id WHERE s.twitch_user_id = '632557806' AND o.event_type = 'donation'"
  ```

- To see it, Vilela presses **Preview Alert** on the Donation card of the overlay settings page
  (`/dashboard/overlay`), signed in as himself and off stream. The owner cannot press it for him: the test route
  (`POST /dashboard/overlay/test/:eventType`) acts only on the signed-in streamer's overlays, and the admin panel
  has no overlay test, so the owner's check is the read-only query above. The test plays on every overlay he
  has open (the preview on that page, and OBS if it is open) and, while his chatbot and its donation thank-you
  are on, also posts his donation thank-you in his Twitch chat, filled with the test values (`BigSponsor`,
  25 USD, `Keep racing!`; with the default text, for example, "BigSponsor donated 25! Keep racing!", but his own
  thank-you text is what is posted), with nothing to mark it as a test. It needs the OBS overlay switch on (it answers `overlay_off` otherwise).

Switching it off (back to the standard donation alert, the folding screen) is plain SQL, run in the container
with a `busy_timeout` so it waits for the app's own writes instead of failing:

```bash
cd /app && node -e "const D=require('better-sqlite3');const d=new D('data/bot.db');d.pragma('busy_timeout = 10000');console.log(d.prepare(process.argv[1]).run())" "UPDATE overlay_designs SET style = NULL WHERE event_type = 'donation' AND streamer_id = (SELECT id FROM streamers WHERE twitch_user_id = '632557806')"
```

It must print `changes: 1`. An overlay that is already open picks it up after a builder save or a reconnect.
To switch it back on, run the same command with `SET style = 'donation-c1'`. If it prints `changes: 0`, either
his Twitch user id is no longer `632557806` (run the read-only check above) or he has no donation design row
(the builder's Reset deletes a design that has no style): in the second case, have him save his Donation design
once in the Overlay Builder, which writes the row, and run the command again.

Never switch it by loading `src/db.js` in a second process (`require('/app/src/db.js')`): loading it runs every
boot migration against the live database while the app is using it.

Since the alert styles (release A), Vilela (or anyone signed in as him) can also change it in the Overlay Builder:
the C1 is the first look of his Donation tab's Style gallery, marked "Made for you", and picking another look and
saving changes it (the SQL above still works). A builder page opened before release A sends no look with its save,
so the stored look stays.

Going back to an earlier release is a plain revert (older code never reads `style`), but older code's save
writes the whole row again and would drop the style; after coming back, set it again with the command above
(`SET style = 'donation-c1'`).

### The C1 for any streamer

The same C1 is also a look any streamer can have: `donation-c1-channel`. Its rear window carries the streamer's
own Twitch login in capitals instead of VILELA (the overlay page and the Overlay Builder give it to the drawing
as `window.ATLETA_CHANNEL`; a streamer without a linked Twitch account gets plain glass). Streamers pick it
themselves in the Overlay Builder's donation gallery (alert styles, release A). By hand, give it to a streamer
who asks, naming them by their Twitch login. First, read only:
their row, and their donation design with its current look (`style` null is the standard donation alert; with
`card_width` null too, they have no donation design yet):

```bash
cd /app && node -e "const D=require('better-sqlite3');console.log(JSON.stringify(new D('data/bot.db',{readonly:true}).prepare(process.argv[1]).all()))" "SELECT s.id, s.twitch_username, o.style, o.card_width, o.card_position FROM streamers s LEFT JOIN overlay_designs o ON o.streamer_id = s.id AND o.event_type = 'donation' WHERE lower(s.twitch_username) = lower('their_login')"
```

Then switch it on. The last condition means the command only ever replaces the standard donation alert, never
another look (andre_vilela_'s own `donation-c1` among them):

```bash
cd /app && node -e "const D=require('better-sqlite3');const d=new D('data/bot.db');d.pragma('busy_timeout = 10000');console.log(d.prepare(process.argv[1]).run())" "UPDATE overlay_designs SET style = 'donation-c1-channel' WHERE event_type = 'donation' AND streamer_id = (SELECT id FROM streamers WHERE lower(twitch_username) = lower('their_login')) AND style IS NULL"
```

`changes: 1` means it is on (an open overlay picks it up after a builder save or a reconnect). `changes: 0` means
no streamer has that login, they have no donation design yet (have them save their Donation design once in the
Overlay Builder, which writes the row, and run it again), or their donation already has another look (the
read-only query shows which). To give them the standard donation alert back:

```bash
cd /app && node -e "const D=require('better-sqlite3');const d=new D('data/bot.db');d.pragma('busy_timeout = 10000');console.log(d.prepare(process.argv[1]).run())" "UPDATE overlay_designs SET style = NULL WHERE event_type = 'donation' AND streamer_id = (SELECT id FROM streamers WHERE lower(twitch_username) = lower('their_login')) AND style = 'donation-c1-channel'"
```

None of these commands needs a deploy.

## Alert styles (release A)

What changes when it deploys:
- Four columns are added to `overlay_designs` (`style_accent`, `style_label`, `style_sound`, `style_grows`); the boot log shows `[DB] Added style_… to overlay_designs` four times, once. Nothing stored is rewritten.
- The giveaway winner alert becomes Racing's Victory lap for every streamer (decided). Its saved colours, text and screen effect carry over; it plays the look's fanfare unless the streamer uploaded a sound.
- Every other alert stays exactly as it is until its streamer picks a look in the Overlay Builder's Style section (now the Animation tab of the edit window).
- Every streamer's donation gallery offers the C1 with their own Twitch name (`donation-c1-channel`), to pick themselves.
- The overlay page and the builder load `/overlay/objects/kit.js`, `/overlay/objects/styles.js?v=…` and `.css`, and `/overlay/fx.js`/`fx.css`. An open OBS source reloads itself when the server restarts.

After the deploy (while no streamer is live):
1. `/health` answers 200, and the boot log shows the four `Added style_…` lines.
2. In the Overlay Builder, the Style section (now the Animation tab of the edit window) opens each of the six alert tabs. Pick Racing's Fly-by for the follow, save, and press Test: OBS plays it.
3. Pick a colour far from the look's own (cyan on a red look) and test again: the change is obvious.
4. andre_vilela_'s donation still shows the C1, first in his gallery as "Made for you"; another streamer's donation gallery shows "C1 with your name", with their Twitch name on the rear window.

Rolling back is safe: older code ignores the four columns, and a style id it does not know (`follow-racing`) draws the alert's own object.

## Alert styles (release B)

What changes when it deploys:
- The Overlay Builder's gallery gets the other 24 families (144 looks): Grand Prix, Cockpit, Arcade, Quest, Comic,
  Cozy, Cosmos, Glass, Spooky, Cyber, Western, Retro OS, Graffiti, Kawaii, Steampunk, Frost, Neon Sign, Deep Sea,
  Music, Stadium, Fireworks, Dino, UFO and Breaking News. "Use <family> for all six" offers each of them.
- Nothing stored changes: no column, no migration, no look anyone picked. Every alert stays as it is until its
  streamer picks one of the new looks.
- The joined family files grow to about 1.1 MB (about 240 KB as Cloudflare compresses them); an open OBS source
  fetches them again once, after the server restarts. The builder loads every family's fonts in one stylesheet
  (44 fonts).

After the deploy (while no streamer is live):
1. `/health` answers 200, and `/overlay/objects/styles.js` registers 26 families.
2. In the Overlay Builder, the gallery of each alert shows the 26 families. Pick Spooky's Treat bucket for the bits,
   save, and press Test: OBS plays it.
3. Pick a cyan colour on a new look and test again: its main parts follow the colour.
4. Turn "Grows with the amount" off on that look and test a big cheer: the middle picture, the real number.

Rolling back is safe: older code does not know the new looks and draws the alert's own object (release A's rule).
Until a streamer who picked one picks a look the older code knows, the builder refuses to save that alert.


## Polls, predictions and shoutouts

Before:

1. No streamer is live and no giveaway is open.
2. The release adds eleven `streamers` columns and the `poll_templates` table at boot: the log shows eleven
   `[DB] Added … column to streamers` lines once, and no `[DB migration]` line. Going back to the previous
   release is a plain revert (the new columns and table stay, unused).
3. No new variable.

After: `/health` answers 200; `/overlay/poll.css`, `/overlay/pollModel.js` and `/js/dashboard-polls.js` answer
200. A streamer is subscribed to the seven poll and prediction events only once their Twitch connection has
the two new permissions.

Watch after release:

- The first real not-Affiliate refusal: Twitch documents no status for it, so it is recognised by Twitch's
  message. Check that its `[Polls]` line in the log says `not_affiliate`, and that the card, once reloaded,
  offers Check again. If the line says `refused` instead, Twitch worded it without "affiliate" or "partner":
  the card then asks to check the question, the choices and the channel's settings, and the line shows
  Twitch's words.
- A channel that is not an Affiliate but has the two permissions: whether Twitch accepts the seven poll and
  prediction subscriptions for it. If it refuses, each EventSub connection of that streamer logs seven
  `[EventSub] Failed to subscribe …` lines; nothing else changes.
- The six non-English translations of the new texts are machine-made and want a native read-through.

### What streamers see

- **Everyone:** a dashboard tab that was open across the deploy needs one reload.
- **Shoutouts** card (after Commands): `!so @name` for moderators and a shoutout after a raid, both off until
  switched on; the message is editable, and Test in chat shouts out the streamer's own channel.
- **Polls & predictions** card (after Giveaways), for Twitch Affiliates and Partners: it asks for one
  "Reconnect Twitch" (two new permissions) before it can start anything; then templates, live results, the
  chat announcements (on by default) and their texts.
- **The on-stream bar** is a new OBS browser source (its link is on the Polls & predictions card and on the
  OBS overlay card; recommended size 600 x 700). It is empty while nothing runs.

## Recorded look sounds

What changes when it deploys (docs/features/look-sounds.md):
- Every alert look plays a recorded sound instead of a synthesized one, and the Overlay Builder's sound list offers
  each sound twice: "<name>" (version A, the default) and "<name> (version 2)", by theme (the edit window's Sound tab, since
  the cards release, lists only the alert's own sounds, with theme chips and search). 312 MP3s, about 13 MB in the
  image, under `/overlay/objects/sounds/`, served with a one-year cache (their names carry their content hash).
- Nothing stored changes: no column, no migration. A saved `style_sound` keeps working; the new `<key>.2` values only
  exist once a streamer picks a second version.
- An alert with no look picked keeps today's object and today's engine sound (until the next release: "Glass, the
  default look" below). A streamer who picked one of the five
  Samurai presets now hears its Samurai recording instead of today's sound; every other look's sound is now its
  recording.
- Six sounds have new names in all seven languages (rcNumber, rcNitro, upshift, pb, samuraiTaiko, samuraiTaiko3),
  because their sounds changed on the owner's notes.
- The recordings sit at −16 LUFS, about the level of the default engine sounds; the old synthesized look sounds were
  about 18 dB quieter, so a streamer who turned a look up in OBS may want it lower.

After the deploy (while no streamer is live):
1. `/health` answers 200, and `/overlay/objects/styles.js` ends with `sounds/manifest.js` registering 156 sounds.
2. A recording answers 200 with `Cache-Control: public, max-age=31536000, immutable`, e.g.
   `/overlay/objects/sounds/racing/` plus the `rcFlyby` file named in the manifest.
3. In the Overlay Builder, pick Racing's Fly-by for the follow: ▶ plays the V10 fly-by; pick "Fly-by whoosh
   (version 2)", save, and press Test: OBS plays the second version.
4. An alert with no look still plays the engine sound in OBS (true until "Glass, the default look" below).

Rolling back is safe: older code does not know the `<key>.2` values and plays the look's own (synthesized) sound
for them, and the recordings are simply not fetched.

## Glass, the default look

What changes when it deploys (the owner's decision, 16 October 2026):
- An alert with no look stored (`overlay_designs.style` NULL, or no row at all) draws Glass's look instead of today's
  object: Pill (follow), Ring (sub), Counter (bits), Receipt (donation), Wave (raid) and Spotlight (the giveaway, which
  drew Racing's Victory lap), with Glass's recordings (`glFollow` … `glGiveaway`). `kit.js` `DEFAULT_LOOKS` names them
  and the server's `DEFAULT_STYLES` copies it.
- It plays as the look comes: its own colour, speed 1, its own screen effect (Spotlight's confetti; the other five have
  none) and its own sound, whatever an older builder saved for today's card (`kit.ownSettings`). The place, the width
  and the effect's amount, size and direction stay, as when a streamer picks a look.
- A stored look stays, the Samurai presets (today's objects) included: the builder saves the look it shows, so an
  alert saved in the builder since release A keeps the look it was saved with. On 16 October that meant:
  ricardobsilva98's sub, bits, donation, raid and giveaway, and andre_vilela_'s giveaway, switch to Glass; every other
  stored look (Samurai presets, the C1 with the channel's name) stays. A streamer moves the rest with "Use Glass for
  all six alerts" in the Overlay Builder.
- The builder marks Glass's tile "Default" in every alert's gallery and shows it first after a look made for the
  streamer; the "Today" badge and its text in the seven languages are gone. The overlay asks Google Fonts for Glass's
  fonts (DM Sans, Manrope) when it connects; a first alert in a look waits at most 1.5 s for them, as before.
- Nothing stored changes: no column, no migration.

After the deploy (while no streamer is live):
1. `/health` answers 200 and `/overlay/objects/kit.js` names `follow-glass` in `DEFAULT_LOOKS` (it is served
   `no-store`, so OBS gets it on its next load).
2. In the Overlay Builder, on an alert with no look, Glass's tile is checked and marked "Default", the preview draws it
   and ▶ plays its recording.
3. Press Test on such an alert with OBS open: it draws the Glass look and plays its recording.

Rolling back is safe: nothing stored changed, so older code draws today's objects and the Victory lap again for the
alerts with no look. A builder save made after this release stores Glass's id, which older code draws too (Glass came
with release B).

## The Overlay Builder's cards and edit window

What streamers see when it deploys (`docs/superpowers/specs/2026-10-16-overlay-builder-cards-design.md`):
- `/dashboard/overlay-builder` is a grid of alert cards instead of one tabbed panel: Follow, Subscription, Bits,
  Donation, Raid, Giveaway winner and Sponsor images (and the three YouTube alerts while `features.youtube` is on). Each
  card loops the look the alert is set to, shows its sound and where it sits, and has **Test in OBS** and **Edit
  alert**.
- Edit alert opens a window with the tabs Animation, Customize, Sound and Location (Images, Design and Location for
  Sponsor images; Design and Location for a YouTube alert). **Done** saves the alert; Reset to Default and "Use <theme>
  for all six alerts" act at once. The Sound tab lists only the alert's own sounds.
- Links with `?tab=<card>` (for example `?tab=timed`) open that card's window.
- Nothing to migrate and no data change: the same `overlay_designs` rows, the same save, family, reset and test routes,
  and the OBS overlay is untouched, so an open OBS source needs no reload. The change is the page (`overlay-builder.ejs`,
  `public/js/builder-cards.js`, `public/js/builder-styles-core.js`) and the texts in the seven locales.

After the deploy:
1. `/health` answers 200 and `/dashboard/overlay-builder` shows the cards, two to a row on a wide window, each looping.
2. Edit the Follow alert, pick another look, press Done: the card shows it, a reload keeps it, and an open OBS source
   draws it on the next Test in OBS without a reload.
3. `?tab=timed` opens Sponsor images; an image still uploads, switches and reorders.

Rolling back is safe: nothing stored changed, so the earlier builder reads the same rows.

## Tips read aloud

What changes when it deploys (docs/features/tip-tts.md):
- **Before the release:** set `ELEVENLABS_API_KEY` on the Railway service (Variables). Without it everything else
  ships, and the Donations page says reading tips aloud is not available.
- The donations page has a "Read tips aloud" section (off for every streamer until they turn it on) and the Donations
  card a switch for it; the donation history a TTS column once a streamer has it on. With `features.overlays` off none
  of it shows.
- A PayPal tip at or above the streamer's threshold, with the overlay and the donation alert on and an alert overlay
  open in OBS, waits up to 15 s for its voice, then alerts with it; every other alert is unchanged.
- New columns (`streamers.tts_*`, `donations.tts_status`) and a table (`tts_usage`), added at boot: `[DB] Added tts_…
  column to streamers` (twelve times) and `[DB] Added tts_status column to donations`, once each. The voice files live
  in `data/tts/<streamerId>/` and are removed after an hour. The 37 voice previews (`public/tts/previews/`, about 2 MB)
  are served with a one-year cache.
- Cost: at most 15,000 characters a month per streamer (an admin changes one streamer's limit in the admin panel's
  Users tab); nothing is read while the account has fewer than `TTS_CREDIT_FLOOR` (20,000) credits left. The account is
  the one the look sounds were made with.

After the deploy (while no streamer is live):
1. `/health` answers 200, and the boot log has the `[DB] Added tts_…` lines once and no `[DB migration]` line.
2. A preview answers 200 with `Cache-Control: public, max-age=31536000, immutable`, e.g. the `preview` of the first
   English voice in `src/services/ttsVoices.js` under `/tts/previews/`.
3. On `/dashboard/donations`, the "Read tips aloud" section shows (not "not available"); ▶ next to a voice plays its
   preview; switch it on, save, and press **Test the voice** with the alert overlay open in OBS: the page plays the
   sample, OBS shows a donation alert and reads it after the alert's sound, and "This month" grows by the line's
   length. A `[TTS] Streamer <id>: …` line instead means it failed (see "Log lines worth knowing").
4. Switch it off again if it was only for the check.

Rolling back is safe: the new columns and table stay and older code ignores them; voice files left in `data/tts/` are
not served and can be deleted.


## Tracking (goal bars and trackers)

What changes when it deploys (`docs/features/tracking.md`):
- **At boot**, on the existing database: five new tables (`tracking_events`, `tracking_goals`, `tracking_goal_periods`,
  `tracker_values`, `tracker_settings`), created quietly, and one new `channel_state` column. The log shows
  `[DB] Added last_stream_started_at column to channel_state` once and **no** `[DB migration]` line, on the first boot
  and on every boot after. Nothing is added to `streamers`.
- **The tracker seed runs once** (`_runOnce('tracking_seed_trackers')`, recorded in `data_migrations`): it fills each
  streamer's Latest follower, sub, tip, raid and bits from the newest `overlay_events` row of that kind (the last 30
  days) and the newest `donations` row (the log shows `[DB] Filled N tracker value(s) from the last events and tips`
  once, when N is above 0). It creates no goal and writes nothing else.
- **Own channels are polled every minute now.** `pollAllTwitchLive` asks Twitch about every enabled streamer's own
  linked channel as well as the watched ones, so the `[TwitchLive] Polling N channels: …` line (once per boot) grows to
  the union and the minute's `/streams` batches grow with it (100 logins per request; for roughly as many streamers as
  watched channels, about double the logins, so at most a few more requests a minute). A channel nobody watches only
  gets its `channel_state`; nothing is posted for it. When such a stream ends the recap is still built, which is two
  Helix calls (clips and the VOD lookup) per stream end that nobody receives, and no follower count is read for it
  (no watcher token). A watched own channel costs nothing extra.
- **No new variable**, and no change to the Railway settings. A streamer with an active goal or a switched-on tracker
  keeps an EventSub connection even with the overlay and the chatbot off, so the boot line
  `[EventSub] Started N connections` can count more streamers than before once streamers set Tracking up (a new streamer
  has none until then).
- **The record grows** (`tracking_events`, one row per follow or sub, kept 400 days, cleaned every 6 hours). Rows only
  appear for streamers whose EventSub connection runs, so growth is small at first.

What streamers see:
- **Everyone:** a dashboard tab open across the deploy needs one reload. The OBS overlay card has a new link,
  **Tracking** (only while `features.overlays` is on), to `/dashboard/tracking`.
- **The Tracking page** (new): a follower goal and a sub goal (lifetime, calendar or rolling year, month, week or day,
  or hours, in a time zone they choose), six trackers (Latest follower, sub, tip, raid, bits; Top tipper), each its own
  OBS browser source with a preview and a Copy button. Latest follower, sub, tip, raid and bits already show their last
  value from the seed.
- **"Reconnect Twitch"** on a goal means the broadcaster authorization lacks `moderator:read:followers` or
  `channel:read:subscriptions` (a connection made before them): it asks for a fresh one, as the other cards do. A
  channel without subs sees the sub goal and Latest sub as "not available".
- A period sub goal counts only the subs EventSub delivers (new, gifted, resubs announced in chat): a silent renewal is
  not counted, and the card says so. A lifetime sub goal uses Twitch's own total.

After the deploy (while no streamer is live):
1. `/health` answers 200; the boot log has the `last_stream_started_at` line and the `Filled N tracker value(s)` line
   once and no `[DB migration]` line; a second boot (or a restart) prints no `[DB]` line for Tracking at all.
2. `/overlay/tracking.js` and `/overlay/tracking.css` answer 200 (`no-store`, like the rest of `/overlay/`), and
   `/overlay/tracker/latest_follower/<an overlay token>` answers 200 (an unknown token or tracker answers 404).
3. `/dashboard/tracking` opens from the OBS overlay card. Start a monthly calendar follower goal: its bar draws and the
   status line shows the count; start a lifetime sub goal: it shows Twitch's current total (a Twitch outage answers
   "Twitch did not answer", and the goal is not started). Press Test on both with the OBS sources open: they play and
   revert after 10 s. End the goals if they were only for the check.
4. Within a few minutes the log's `[TwitchLive] Polling N channels` line (after the next boot) names the streamers'
   own channels, and no `[TwitchLive] Could not check …` line repeats (a failing batch leaves channels as they were).
5. While a streamer with Tracking set up goes live: their `channel_state` gets `stream_started_at`, and their Top tipper
   resets for that stream.

Watch after release:
- `[TwitchLive] Could not check N channel(s)` after the first deploy (the batches are larger): the app token's
  `/streams` budget is shared with the watchers' polls.
- A `[TrackingGoal]` line saying a total or a read-back did not answer: the goal keeps the last total and tries again at
  its next read (10 minutes for lifetime totals, 30 for follower read-backs).

Rolling back is safe: the new tables and the column stay and older code ignores them (nothing older reads or writes
them); the Tracking sources and page simply stop existing, and OBS shows a blank source until it is removed. The record
and goals are kept for when the release comes back.
