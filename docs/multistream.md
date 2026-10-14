# Multistream — Resume Plan

**Status as of 2026-05-10:** Code is fully shipped. Infrastructure (Oracle VM + MediaMTX) is **NOT yet set up** — feature won't work until that's done.

Until the env vars from step 6 below are set on Railway, multistream is switched off: the dashboard card is hidden, `/dashboard/multistream` sends streamers back to the dashboard and `/api/multistream/*` answers 404 (saved settings are kept). Setting them switches it on for every streamer.

---

## What's already done (no action needed)

All code, tests, and docs are in the repo. Specifically:

- Service files: `src/services/multistreamRelay.js` (relay API client), `src/services/multistreamSessions.js` (go-live, stop, minute check), `src/services/multistreamAuth.js` (who may publish), `src/services/youtubeBroadcast.js`
- Route: `src/routes/multistream.js` — a dashboard router at `/dashboard/multistream` and an API router at `/api/multistream` (relay auth + webhooks)
- New view: `src/views/multistream.ejs`
- DB migration applied: 9 new columns on `streamers` (`multistream_*`)
- Twitch broadcaster OAuth (`/auth/broadcaster`) asks for `channel:read:stream_key` only once the relay variables (step 6) are set, so streamers are not asked for the permission of a feature they cannot see; the first time after that they re-authorize (step 7)
- Dashboard card added (Twitch tab) linking to the multistream page (hidden until the relay variables are set)
- Unit tests: `node --test tests/multistreamRelay.test.js src/services/multistream*.test.js src/services/youtubeBroadcast.test.js src/routes/multistream.test.js`
- Detailed operator runbook: `docs/multistream-relay-setup.md`
- Implementation plan (historical): `docs/superpowers/plans/2026-05-10-multistream-relay.md`
- CLAUDE.md updated with architecture + env vars

The Oracle Cloud account is already created.

---

## What's left (the actual work)

When you have ~30–45 minutes free, work through these steps in order. The detailed operator runbook is at `docs/multistream-relay-setup.md` — this file is the higher-level "where we left off" checklist.

### Step 1 — Create the VM (10 min)

**Pre-req:** Have an SSH key ready. Check existing:
```bash
ls ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub 2>/dev/null
```
If none exists:
```bash
ssh-keygen -t ed25519 -C "atleta-relay" -f ~/.ssh/atleta_relay_ed25519
# (press Enter at each prompt — no passphrase needed)
cat ~/.ssh/atleta_relay_ed25519.pub
# copy the output
```

In Oracle Cloud Console:
1. Hamburger menu → **Compute** → **Instances** → **Create instance**
2. Name: `atleta-relay`
3. **Image and shape** → Edit:
   - Image: **Canonical Ubuntu 22.04 Minimal**
   - Shape: **Ampere → VM.Standard.A1.Flex** with **2 OCPU / 12 GB RAM**
4. **Networking:** keep default VCN, ensure **Assign public IPv4** is checked
5. **SSH keys:** paste your public key
6. **Boot volume:** leave defaults (47 GB free)
7. Click **Create**

Wait ~2 min for status to go **Running**. Copy the public IP.

> If you see **"Out of host capacity"** — Oracle's ARM tier is famously tight. Just retry every few minutes; usually clears within an hour.

### Step 2 — Open port 1935 in the security list (2 min)

In the VM detail page → click the **VCN** link → **Security Lists** → click the default security list → **Add Ingress Rules**:
- Source CIDR: `0.0.0.0/0`
- IP Protocol: **TCP**
- Destination Port Range: **1935**
- Description: "RTMP ingest"

(Port 22 for SSH should already be open from the default rules.)

### Step 3 — Install + configure MediaMTX (15 min)

SSH in:
```bash
ssh ubuntu@<your-vm-ip>
```

Then follow `docs/multistream-relay-setup.md` sections **2** through **4**. Summary:
- Install MediaMTX 1.21.2 (1.20 or newer) + ffmpeg
- Generate two random secrets: `API_PASS=$(openssl rand -hex 32)`, `HOOK_SECRET=$(openssl rand -hex 32)` — **save these somewhere**, you'll need them in Railway
- Drop in `/etc/mediamtx/mediamtx.yml` (full config in the runbook section 3: the relay asks the website who may publish, with `HOOK_SECRET`)
- Create the systemd unit, enable+start the service
- Verify with `sudo systemctl status mediamtx` and `sudo journalctl -u mediamtx -f`

You should see `[RTMP] listener opened on :1935` in the logs.

### Step 4 — Cloudflare Tunnel for the API (10 min)

Install `cloudflared` on the VM, create a tunnel in Cloudflare's Zero Trust dashboard, point `relay.atletanotifications.com` → `http://localhost:9997`. Full steps in runbook section **5**.

Recommended: Cloudflare Access with a service token in front of `relay.atletanotifications.com` (runbook section 5).

The API test (`curl -u admin:<API_PASS> https://relay.atletanotifications.com/v3/paths/list`) only works after step 6: the relay asks the website about every login.

### Step 5 — DNS for the ingest subdomain (2 min)

Cloudflare DNS for `atletanotifications.com`:
- Add **A record** `ingest` → your Oracle VM's public IPv4
- **Proxy status: DNS only (gray cloud)** — Cloudflare doesn't proxy raw RTMP

### Step 6 — Set Railway env vars (3 min)

In Railway → your project → Variables:
```
MEDIAMTX_API_URL=https://relay.atletanotifications.com
MEDIAMTX_INGEST_URL=rtmp://ingest.atletanotifications.com/live
MEDIAMTX_API_TOKEN=<API_PASS from step 3>
MEDIAMTX_WEBHOOK_SECRET=<HOOK_SECRET from step 3>
# Optional: MEDIAMTX_API_USER (default admin), MEDIAMTX_CF_ACCESS_CLIENT_ID / _SECRET (Cloudflare Access)
```

All four are needed; `MULTISTREAM_KEY_SECRET` is no longer used. Railway redeploys on the change, and the Multistream card appears for every streamer — run step 8 right away. The card and `/dashboard/multistream` also need `features.youtube: true` in `src/config.js` (they are hidden while YouTube is). To hide it again, unset `MEDIAMTX_API_URL`.

### Step 7 — Re-auth Twitch broadcaster (1 min)

Visit `/dashboard/multistream` while logged in. The Twitch destination card will likely show:
> ● Authorized, but missing the stream-key permission. Re-authorize to enable multistream.

Click **Re-authorize** → confirm Twitch consent → done. The new `channel:read:stream_key` scope is now granted.

(YouTube re-auth is **NOT** needed if you've already connected YouTube for the chatbot feature — the existing `youtube` scope already covers broadcast management.)

### Step 8 — Smoke test (5 min)

1. At `/dashboard/multistream`:
   - Set YouTube privacy to **Unlisted** (safest for testing)
   - Toggle **Enable Multistream** ON
   - Save
2. In OBS on a test machine:
   - Settings → Stream → Service: **Custom**
   - Server: `rtmp://ingest.atletanotifications.com/live`
   - Stream key: copy from the dashboard
   - Click **Start Streaming**
3. Within ~10s — live on Twitch. YouTube starts the broadcast by itself once it receives the stream (10–30 s more).
4. Stop OBS → a minute later the forwarders stop and the YouTube broadcast is completed (a restart within that minute continues the same broadcast).

If something fails:
- **Relay logs:** SSH to VM, `sudo journalctl -u mediamtx -f`
- **Express logs:** `railway logs --tail` — look for `[multistream]` lines

---

## Quick reference

| Thing | Where |
|---|---|
| Detailed step-by-step | `docs/multistream-relay-setup.md` |
| Code: services | `src/services/{multistreamRelay,multistreamSessions,multistreamAuth,youtubeBroadcast}.js` |
| Code: routes + view | `src/routes/multistream.js`, `src/views/multistream.ejs` |
| DB schema | `src/db.js` (search for "Add multistream relay columns") |
| Original implementation plan | `docs/superpowers/plans/2026-05-10-multistream-relay.md` |
| Run unit tests | `node --test tests/multistreamRelay.test.js src/services/multistream*.test.js src/services/youtubeBroadcast.test.js src/routes/multistream.test.js` |

## When you resume

Just say "let's pick up the multistream VM setup" — the code is done; you're starting at **Step 1** above (or wherever you left off).

Total time when uninterrupted: ~30–45 minutes.
