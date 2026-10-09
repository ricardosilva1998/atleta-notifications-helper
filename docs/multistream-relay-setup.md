# Multistream Relay Setup (Oracle Cloud + MediaMTX)

This document is for the operator (you). The streamer-facing UI is at `/dashboard/multistream` and surfaces none of this.

The relay is the only piece of infrastructure this feature depends on. Without it, the dashboard shows a "relay not configured" warning and ingest URLs aren't usable. With it, streamers point OBS at one URL and we fan out their RTMP feed to Twitch + YouTube simultaneously.

## Why this is free

Oracle Cloud's "Always Free" tier gives one ARM Ampere A1 VM (4 vCPU / 24 GB RAM) and **10 TB of egress per month, forever**. Two-destination passthrough at 6 Mbps ≈ 5.4 GB/hour per active streamer — the cap covers ~1,850 streamer-hours/month before any spend.

For 1–4 streamers this is wildly under-utilized.

---

## 1. Provision the VM

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
2. Create a VM:
   - **Shape:** `VM.Standard.A1.Flex` (ARM Ampere A1) — 2 OCPU / 12 GB RAM is plenty.
   - **Image:** Ubuntu 22.04 (or newer LTS) Minimal.
   - **Region:** São Paulo (closest to Brazil-based streamers).
   - **Networking:** assign a public IPv4. Open Security List ingress for **TCP 1935** (RTMP). Keep **9997** (MediaMTX API) closed to the public internet — we'll expose it via Cloudflare Tunnel.
3. **DNS:** add an A record `ingest.atletanotifications.com` → the VM's public IPv4. **Cloudflare proxy must be off** (gray cloud, "DNS only") — Cloudflare doesn't proxy raw RTMP.

## 2. Install MediaMTX + ffmpeg

SSH in and install dependencies:

```bash
ssh ubuntu@<vm-ip>
sudo apt update && sudo apt install -y ffmpeg curl
```

Install MediaMTX (check [latest release](https://github.com/bluenviron/mediamtx/releases)):

```bash
ARCH=arm64v8     # use linux_amd64 if you accidentally provisioned an x86 box
VER=1.8.0        # bump to whatever's current
curl -L "https://github.com/bluenviron/mediamtx/releases/download/v${VER}/mediamtx_v${VER}_linux_${ARCH}.tar.gz" \
  | sudo tar -xz -C /usr/local/bin mediamtx
sudo useradd -r -s /bin/false mediamtx
sudo mkdir -p /etc/mediamtx
sudo chown mediamtx:mediamtx /etc/mediamtx
```

## 3. Configure MediaMTX

Generate two random secrets you'll mirror to Railway env vars:

```bash
API_PASS=$(openssl rand -hex 32)
HOOK_SECRET=$(openssl rand -hex 32)
echo "API_PASS=$API_PASS"
echo "HOOK_SECRET=$HOOK_SECRET"
```

Save them somewhere — you'll need both.

Create `/etc/mediamtx/mediamtx.yml`:

```yaml
logLevel: info
logDestinations: [stdout]

# RTMP ingest from streamers' OBS
rtmp: yes
rtmpAddress: :1935

# We don't need anything else
hls: no
webrtc: no
srt: no
rtsp: no

# HTTP control API — bind to localhost only, expose via Cloudflare Tunnel
api: yes
apiAddress: 127.0.0.1:9997
authInternalUsers:
  - user: any
    pass: any
    permissions:
      - action: publish
      - action: read
  - user: admin
    pass: REPLACE_WITH_API_PASS
    permissions:
      - action: api

# Webhooks — Express app handles broadcast lifecycle + ffmpeg fan-out
runOnReady: 'curl -sS -X POST -H "Authorization: Bearer REPLACE_WITH_HOOK_SECRET" -H "Content-Type: application/json" -d ''{"path":"$MTX_PATH"}'' https://atletanotifications.com/api/multistream/webhook/on-ready'
runOnNotReady: 'curl -sS -X POST -H "Authorization: Bearer REPLACE_WITH_HOOK_SECRET" -H "Content-Type: application/json" -d ''{"path":"$MTX_PATH"}'' https://atletanotifications.com/api/multistream/webhook/on-not-ready'

# Accept any /live/<token> publish
paths:
  ~^live/.*$:
    source: publisher
```

Replace `REPLACE_WITH_API_PASS` and `REPLACE_WITH_HOOK_SECRET` with your generated values, then lock down the file:

```bash
sudo chown root:mediamtx /etc/mediamtx/mediamtx.yml
sudo chmod 640 /etc/mediamtx/mediamtx.yml
```

## 4. Run as a systemd service

`/etc/systemd/system/mediamtx.service`:

```ini
[Unit]
Description=MediaMTX
After=network.target

[Service]
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
User=mediamtx
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx
sudo systemctl status mediamtx
sudo journalctl -u mediamtx -f --since "1 minute ago"
```

You should see `[RTMP] listener opened on :1935` and `[API] listener opened on 127.0.0.1:9997`.

## 5. Expose the API to Railway via Cloudflare Tunnel

The MediaMTX HTTP API binds to `127.0.0.1:9997` for safety. Railway needs to reach it — Cloudflare Tunnel is the cleanest way (no inbound port open).

```bash
# On the relay VM
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
```

In Cloudflare dashboard:
1. **Zero Trust → Networks → Tunnels → Create a tunnel**
2. Name it `atleta-relay`. Copy the install command (`sudo cloudflared service install <TOKEN>`) and run it on the VM.
3. Add a Public Hostname: subdomain `relay`, domain `atletanotifications.com`, service `http://localhost:9997`.

Test from anywhere:
```bash
curl -u admin:<API_PASS> https://relay.atletanotifications.com/v3/paths/list
# Expected: {"itemCount":0,"pageCount":0,"items":[]}
```

## 6. Set the Railway env vars

In Railway → your project → Variables:

```
MEDIAMTX_API_URL=https://relay.atletanotifications.com
MEDIAMTX_INGEST_URL=rtmp://ingest.atletanotifications.com/live
MEDIAMTX_API_TOKEN=<the API_PASS from step 3>
MEDIAMTX_WEBHOOK_SECRET=<the HOOK_SECRET from step 3>
MULTISTREAM_KEY_SECRET=<openssl rand -hex 32>
```

The `MULTISTREAM_KEY_SECRET` must be a 64-char hex string. Generate locally with `openssl rand -hex 32`. **Don't lose it** — if it changes, all stored YouTube stream IDs become unreadable (no real data loss; you'd just re-bind via the dashboard's "Reset stream binding" link).

Restart the Railway service. The "relay not configured" warning at `/dashboard/multistream` should be gone.

## 7. Twitch broadcaster scope upgrade

Existing connected streamers need to **re-authorize** via `/auth/broadcaster` (one click) to grant the new `channel:read:stream_key` scope. The dashboard surfaces this with an amber banner: "Authorized, but missing the stream-key permission. Re-authorize to enable multistream."

New streamers get the right scopes from the start.

## 8. End-to-end smoke test

1. As a logged-in test streamer:
   - Click **Connect Twitch** at `/dashboard/multistream` (re-auth if needed).
   - Click **Connect YouTube** (re-auth to grant the full `youtube` scope on top of the existing `youtube.readonly`).
   - Set defaults (privacy: **Unlisted** is safest for testing).
   - Toggle **Enable Multistream** ON.
   - **Save Settings**.
2. In OBS on a test machine:
   - Settings → Stream → Service: **Custom**.
   - Server: `rtmp://ingest.atletanotifications.com/live`
   - Stream key: copy from the dashboard.
   - Click **Start Streaming**.
3. Within ~10 seconds you should be live on Twitch. YouTube takes another ~10s for the broadcast to transition to live.
4. Stop streaming → both platforms go offline within ~10 seconds. The YouTube broadcast appears in Studio under "Past broadcasts".

If something fails, check both sides:
- **Relay logs:** `sudo journalctl -u mediamtx -f` on the VM
- **Express logs:** `railway logs --tail` — look for `[multistream on-ready]` lines

## 9. Egress monitoring

Until automated cap enforcement is built, eyeball Oracle Cloud's "Networking → Bandwidth" dashboard once a week. With 1–4 streamers you're nowhere near 10 TB. If you scale up and approach the cap before month end, temporarily disable globally by **unsetting `MEDIAMTX_API_URL`** on Railway — the dashboard reverts to the "not configured" warning, new streams aren't forwarded; existing streams continue until they end naturally.

## 10. Heartbeat against Always-Free reclamation

Oracle reclaims VMs flagged as idle. Add a cron on the VM to keep the network interface busy:

```bash
crontab -e -u ubuntu
# add:
* * * * * curl -s https://atletanotifications.com/health > /dev/null
```

One curl per minute is enough activity for Oracle's idle detection.

---

## Architecture cheat sheet

```
[OBS on streamer PC]
       │
       │  one RTMP push (1080p60 @ ~6 Mbps)
       ▼
[ingest.atletanotifications.com:1935]   ◄── DNS A → Oracle VM public IP
       │
[MediaMTX on Oracle Always-Free VM]
       │  (1) runOnReady fires
       ▼
[POST https://atletanotifications.com/api/multistream/webhook/on-ready]
       │  (auth: Bearer MEDIAMTX_WEBHOOK_SECRET)
       │
[Express app on Railway]
       │  (2) lookup streamer by multistream_token
       │  (3) Twitch Helix /streams/key  → Twitch RTMP key
       │  (4) YouTube Data API: getOrCreateLiveStream + createBroadcast + bind
       │  (5) Persist multistream_active_broadcast_id
       │  (6) MediaMTX /v3/config/paths/add/* (×2)
       │     body.runOnReady = "ffmpeg -c copy -f flv ..."
       ▼
[MediaMTX spawns 2 ffmpeg processes]
       │  ─→ rtmp://live.twitch.tv/app/<twitch-key>
       │  ─→ rtmp://a.rtmp.youtube.com/live2/<youtube-key>
       │
       │  (async, after webhook responds)
       ▼
[Express background] waitForStreamActive(60s) → transition→live on YouTube

[OBS Stop Streaming]
       │
[MediaMTX runOnNotReady fires]
       ▼
[POST /api/multistream/webhook/on-not-ready]
       │  (1) Remove forwarder paths (ffmpeg processes die)
       │  (2) YouTube transition→complete
       │  (3) Clear active_broadcast_id
```

No re-encoding anywhere. The ffmpeg `-c copy` flag means we just remux RTMP packets — same H.264/AAC bytes the streamer sent, two copies sent out.
