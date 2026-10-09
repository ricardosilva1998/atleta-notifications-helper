# Multistream — Resume Plan

**Status as of 2026-05-10:** Code is fully shipped. Infrastructure (Oracle VM + MediaMTX) is **NOT yet set up** — feature won't work until that's done.

The dashboard at `/dashboard/multistream` will load and accept settings but will show a "relay not configured" warning until the env vars from step 6 below are set on Railway.

---

## What's already done (no action needed)

All code, tests, and docs are in the repo. Specifically:

- New service files: `src/services/streamKeyCrypto.js`, `src/services/multistreamRelay.js`, `src/services/youtubeBroadcast.js`
- New route: `src/routes/multistream.js` mounted at `/dashboard/multistream` and `/api/multistream`
- New view: `src/views/multistream.ejs`
- DB migration applied: 9 new columns on `streamers` (`multistream_*`)
- Twitch broadcaster OAuth scope expanded with `channel:read:stream_key`
- Dashboard card added (Twitch tab) linking to the multistream page
- 16 unit tests, all passing: `node --test tests/streamKeyCrypto.test.js tests/multistreamRelay.test.js`
- Visual mockup: `docs/multistream-mockup.html` (open in browser to see the UI)
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
- Install MediaMTX 1.8.0 binary + ffmpeg
- Generate two random secrets: `API_PASS=$(openssl rand -hex 32)`, `HOOK_SECRET=$(openssl rand -hex 32)` — **save these somewhere**, you'll need them in Railway
- Drop in `/etc/mediamtx/mediamtx.yml` (full config in the runbook section 3)
- Create the systemd unit, enable+start the service
- Verify with `sudo systemctl status mediamtx` and `sudo journalctl -u mediamtx -f`

You should see `[RTMP] listener opened on :1935` in the logs.

### Step 4 — Cloudflare Tunnel for the API (10 min)

Install `cloudflared` on the VM, create a tunnel in Cloudflare's Zero Trust dashboard, point `relay.atletanotifications.com` → `http://localhost:9997`. Full steps in runbook section **5**.

Test:
```bash
curl -u admin:<API_PASS> https://relay.atletanotifications.com/v3/paths/list
# Expected: {"itemCount":0,"pageCount":0,"items":[]}
```

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
MULTISTREAM_KEY_SECRET=<openssl rand -hex 32>
```

Generate the `MULTISTREAM_KEY_SECRET` locally:
```bash
openssl rand -hex 32
```

**Don't lose `MULTISTREAM_KEY_SECRET`.** If it changes, stored YouTube stream IDs become unreadable — recoverable (use the dashboard's "Reset stream binding" link), but annoying.

Restart the Railway service after setting vars. The "relay not configured" warning at `/dashboard/multistream` should disappear.

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
3. Within ~10s — live on Twitch. Within another ~10s — live on YouTube (broadcast appears in Studio).
4. Stop OBS → both go offline within ~10s.

If something fails:
- **Relay logs:** SSH to VM, `sudo journalctl -u mediamtx -f`
- **Express logs:** `railway logs --tail` — look for `[multistream on-ready]` lines

---

## Quick reference

| Thing | Where |
|---|---|
| Detailed step-by-step | `docs/multistream-relay-setup.md` |
| Code: services | `src/services/{multistreamRelay,youtubeBroadcast,streamKeyCrypto}.js` |
| Code: routes + view | `src/routes/multistream.js`, `src/views/multistream.ejs` |
| DB schema | `src/db.js` (search for "Add multistream relay columns") |
| Visual mockup | `docs/multistream-mockup.html` (open in browser) |
| Original implementation plan | `docs/superpowers/plans/2026-05-10-multistream-relay.md` |
| Run unit tests | `node --test tests/streamKeyCrypto.test.js tests/multistreamRelay.test.js` |

## When you resume

Just say "let's pick up the multistream VM setup" — the code is done; you're starting at **Step 1** above (or wherever you left off).

Total time when uninterrupted: ~30–45 minutes.
