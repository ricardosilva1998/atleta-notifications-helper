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

No longer read by the code, remove them when convenient: `GITHUB_TOKEN`, `GITHUB_REPO`,
`MULTISTREAM_KEY_SECRET`, `SESSION_SECRET`, `ADMIN_PASSWORD`.

## Rolling out `TOKEN_ENCRYPTION_KEY` (two steps)

1. **Deploy the release without the key.** Session ids are stored as hashes on the first boot
   (cookies stay valid, nobody is logged out); tokens stay as they are; one warning says the key is
   not set. Check the boot log (below) and that logging in, the dashboard and an overlay work. Going
   back at this point costs one re-login for everybody (older code cannot match hashed ids) and nothing else.
2. **Take a fresh backup** (`backup-restore.md`). Then generate the key with `openssl rand -hex 32`,
   keep a copy in a password manager, and set `TOKEN_ENCRYPTION_KEY`. The variable change redeploys
   the same code; its boot encrypts every stored token. Expect `[DB] Encrypted N stored token(s) with
   TOKEN_ENCRYPTION_KEY`, no `cannot be decrypted` line, and no "not set" warning.

A malformed key stops the boot (exit 1) on purpose. With a different key, or none, encrypted tokens
read as "not connected" (they are not deleted, so the right key brings them back) and streamers
would have to connect Twitch, YouTube, Spotify and StreamElements again.

**Do not roll back to a release from before this one once the key is set.** Older code would send
the `enc:v1:` text to Twitch as if it were a token, the refresh would fail and the streamers' scopes
would be cleared, and the hashed session ids would log everyone out. There is no decrypt script: the
only way back is the database copy from step 2 together with the old release (everything written
since is lost). Roll forward instead. Copies made before the key was set hold plaintext tokens until
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

## First deploy of the 2026-10 stream fixes

Before:

1. No streamer is live.
2. The admin's `streamers.discord_user_id` is one of the admin ids (`src/adminAccess.js`); if not, set
   `ADMIN_DISCORD_IDS`.
3. A fresh database copy exists (the orphan clean-up and the new "Remove" delete rows for good).
4. Admin → Users: an account that is switched off now really loses the dashboard, its overlay links and
   its sessions. Switch on the ones that should work.
5. The five main alerts take their saved position and width again (they were ignored). To see who has
   one: `SELECT streamer_id, event_type, card_position, card_custom_x, card_custom_y, card_width FROM
   overlay_designs WHERE event_type IN ('follow','subscription','bits','donation','raid') AND
   (card_position != 'top-center' OR card_custom_x IS NOT NULL OR card_width != 420);`
6. `LINK_SIGNING_SECRET` and `CSRF_SECRET` are set; `WEEKLY_DIGEST_INTERVAL` is not; the service
   settings above are applied.

After: `https://atletanotifications.com/health` answers `{"ok":true}`; the boot log shows the lines
above and no `[DB migration]` error; the first real tip fires its alert (the capture asks PayPal for
the full order, which has not been exercised against the real service: a small test tip is worth it).

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
- **Tip goals:** a goal in another currency than the tip page now shows a warning; use the same currency
  or PayPal tips never count toward it.

Will notice, nothing to do: the Multistream card is hidden until the relay exists; follow and new-sub
thank-yous arrive about five seconds after the alert and merge when several come at once; one alert and
one thank-you per gift sub; giveaways draw winners again; a test button works once every five seconds;
uploads stop at 250 MB per streamer; logout is a button; pages follow the browser's language until a
language is chosen; new Discord invites ask for six permissions instead of Administrator.
