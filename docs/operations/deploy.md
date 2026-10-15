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

Optional: `ADMIN_DISCORD_IDS`, `BOT_CHAT_RATE_LIMIT`, `ANTHROPIC_API_KEY` (+ `TRIAGE_MODEL`) for AI
analysis of reported issues. `YOUTUBE_API_KEY` is **not set** in production, so YouTube livestreams
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

Going back to an earlier release is a plain revert (older code never reads `style`), but older code's save
writes the whole row again and would drop the style; after coming back, set it again with the command above
(`SET style = 'donation-c1'`).
