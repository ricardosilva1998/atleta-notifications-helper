# Database backups and how to restore one

Production keeps everything in one SQLite file on the Railway volume:
`/app/data/bot.db`. This page covers the copies the app makes of it, how to
download one, and how to put one back.

## What the app backs up

- **When:** every night at 03:30 UTC (`src/services/backups.js`, started at boot by `src/index.js`).
- **Where:** `/app/data/backups/bot-YYYY-MM-DD.db` (the UTC date), on the same volume.
- **How:** SQLite's online backup API (`db.backupInto()` in `src/db.js`). Each copy is a
  consistent copy of the whole database, made a few pages at a time while the app keeps
  answering (writes made during the copy are carried into it), then switched to the
  rollback journal so it is one self-contained file. It is written as
  `bot-YYYY-MM-DD.db.tmp` and renamed once complete, so a `bot-YYYY-MM-DD.db` file is
  always a whole database.
- **Kept:** 7 days (today and the six days before), and always the newest copy, however
  old. Older copies are deleted only after a new copy has succeeded, or on a night with no
  room for one, so a failed night never costs an old backup.
- **Skipped** when the copy would leave the volume with less than 200 MB free. That night
  the copies past the 7 days are still removed, keeping the newest, so old backups cannot
  keep a full volume full.
- **Logs:** every run states the database size and the free space:
  `[Backup] Database copied to backups/bot-2026-10-14.db in 0.4 s (database 14.8 MB, 4610.2 MB free)`,
  `[Backup] Failed after 0.2 s: ... (database ..., ... free)`,
  `[Backup] Skipped: a copy would leave less than 200.0 MB free on the data volume (...); removed 2 file(s) past 7 days, kept the newest copy`.
- **Not in it:** uploaded files (alert sounds, sponsor images, reward clips, avatars, VTuber
  models, issue screenshots). They are files under `/app/data/`, and only a Railway volume
  backup covers them.
- No route serves `data/backups/`, or `data/` itself.

A backup holds every account's data, including OAuth tokens, PayPal emails and password
hashes. Treat a downloaded copy as a secret: keep it encrypted, never commit it, and delete
it when you no longer need it.

Once `TOKEN_ENCRYPTION_KEY` is set (`deploy.md`), the OAuth tokens and the StreamElements token in a
copy are encrypted with it, and web sessions are stored as hashes. **Restoring a copy only gets the
connections back if the service has the same key**; keep the key somewhere other than the backups.
Copies made before the key was set hold plaintext tokens until they age out (7 days on the volume).
Service settings, variables and the rollout order are in `deploy.md`.

## These copies live on the same volume: also turn on Railway's

The nightly copies protect against a bad migration, a mistaken delete or a damaged database
file. They do not protect against losing the volume. For that (owner action, in the Railway
dashboard):

1. Open the service → **Backups** tab and set a schedule (Daily and Weekly are the ones to have on).
   Railway keeps **Daily** backups for 6 days, **Weekly** for 27 days and **Monthly** for 89 days;
   several can be on at once. A manual backup can be taken from the same tab, for example before a
   release.
2. Every so often (for example weekly), download one of the nightly copies (below) and keep
   it somewhere off Railway.

## Copy the database by hand, and download a copy

You need the Railway CLI, logged in and linked to the project, with the production
environment selected.

### Make a copy in the container (tested)

Do this before a release or any risky change (`deploy.md`). Open a shell in the running service
with `railway ssh`, then:

```bash
cd /app && mkdir -p data/backups && node -e "const D=require('better-sqlite3');const f='data/backups/pre-release.db';new D('data/bot.db',{readonly:true}).backup(f).then(()=>{const c=new D(f);c.pragma('journal_mode = DELETE');console.log('integrity:',c.pragma('integrity_check',{simple:true}));c.close()})"
```

It must print `integrity: ok`. This is the same online backup the nightly job makes
(`db.backupInto()`), so the app keeps answering while it runs, and the result is one
self-contained file: `/app/data/backups/pre-release.db`.

- Take a Railway volume backup as well (service → **Backups**, above). A copy on the volume does not
  survive losing the volume; a Railway backup does.
- The nightly clean-up removes only files named `bot-YYYY-MM-DD.db`, so `pre-release.db` (or any
  other hand-made `pre-*.db` copy) stays until you delete it. It holds every account's OAuth tokens,
  in plain text if it was made before `TOKEN_ENCRYPTION_KEY` was set. **Delete it once the release
  has settled:** `rm /app/data/backups/pre-release.db`.
- To put it back, follow Restore A below with that file name.

### Download a copy (not verified: check before relying on it)

`railway volume files download` and the `scp` form have never been run against the production
volume. The in-container copy above is the one to rely on.

```bash
# What is there
railway ssh -- ls -l /app/data/backups

# Download one (check before relying on it): paths are relative to the volume, which is
# mounted at /app/data
railway volume files download /backups/bot-2026-10-14.db ./bot-2026-10-14.db

# Or with scp (check before relying on it), using an SSH key registered with Railway. The
# user is the service's domain, or its service instance ID (dashboard → Cmd/Ctrl+K → Copy
# Service Instance ID).
scp <service-domain>@ssh.railway.com:/app/data/backups/bot-2026-10-14.db .

# Check the copy: prints "ok"
sqlite3 bot-2026-10-14.db "PRAGMA integrity_check;"
```

## Restore

Everything written after the backup was taken (new tips, settings changes, laps, sign-ups)
is lost by a restore. Pick a moment when nobody is streaming.

### A. Put back one night's database (a nightly copy)

The same steps put back a hand-made copy: use `data/backups/pre-release.db` where the examples say
`data/backups/bot-2026-10-13.db`. Open a shell in the running service with `railway ssh`, then:

```bash
cd /app

# 1. Check the copy you want to restore: prints "ok"
node -e "const D=require('better-sqlite3'); console.log(new D('data/backups/bot-2026-10-13.db',{readonly:true}).pragma('integrity_check',{simple:true}))"

# 2. Keep the current database, in case you need it back
node -e "require('better-sqlite3')('data/bot.db').prepare('VACUUM INTO ?').run('data/backups/before-restore.db')"

# 3. Copy the backup into the live database. This goes through SQLite's backup API,
#    so the running app is never left with a half-written file.
node -e "const D=require('better-sqlite3'); new D('data/backups/bot-2026-10-13.db',{readonly:true}).backup('data/bot.db').then(()=>console.log('restored'))"
```

4. Restart the service straight away (Railway dashboard → the active deployment →
   **Restart**), so nothing keeps the old data in memory. The restart is graceful: requests
   in progress finish first.
5. Check `https://atletanotifications.com/health` (it answers `{"ok":true}`) and the dashboard.
6. Delete `data/backups/before-restore.db` once you are sure, and any copy you uploaded or made by
   hand (`restore-2026-10-13.db`, `pre-release.db`). The nightly clean-up only removes files named
   `bot-YYYY-MM-DD.db`.

### B. Put back a copy you downloaded

Upload it first, then follow A with that file. Neither upload command has been run against the
production volume: check before relying on them.

```bash
railway volume files upload ./bot-2026-10-13.db /backups/restore-2026-10-13.db
# or: scp ./bot-2026-10-13.db <service-domain>@ssh.railway.com:/app/data/backups/restore-2026-10-13.db
```

A copy made in the container (`pre-release.db`) is already on the volume: there is nothing to upload,
follow A with it.

### C. Put back the whole volume (a Railway volume backup)

This restores the database and every uploaded file together. In the Railway dashboard,
open the service → **Backups** → choose the date → **Restore** → review the staged change
(**Details**) → **Deploy**. Railway mounts a new volume made from that backup and redeploys.
The current volume is kept in the project, unmounted, until you delete it.

## Rehearsal

Restore path A was rehearsed on 2026-10-14, first against the production image (Node 24) on
a fresh local volume, then again with a copy made by the app's own backup code
(`runBackup` with `db.backupInto`) while the app was running. Each time a row was added
after the backup, the backup was copied back with step 3 while the app was running, and
the app was restarted. The row was gone, `PRAGMA integrity_check` said `ok`, `/health`
answered `{"ok":true}`, and step 1 left no files beside the copy.

The in-container copy command ("Make a copy in the container") was run on 2026-10-14 against a
scratch database in WAL mode (Node 24, better-sqlite3 12): it printed `integrity: ok` and left one
self-contained file in rollback-journal mode with every row.
