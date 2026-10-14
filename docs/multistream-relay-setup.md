# Multistream Relay Setup (Oracle Cloud + MediaMTX)

This document is for the operator (you). The streamer-facing UI is at `/dashboard/multistream` and surfaces none of this.

The relay is the only piece of infrastructure this feature depends on. Until the website has all four relay variables (step 6), multistream is switched off: the dashboard card is hidden, `/dashboard/multistream` sends streamers back to the dashboard, and `/api/multistream/*` answers 404. Settings streamers saved are kept. With the relay running and the variables set, streamers point OBS at one URL and the relay fans their RTMP feed out to Twitch + YouTube simultaneously.

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
   - **Networking:** assign a public IPv4. Open Security List ingress for **TCP 1935** (RTMP) only. Keep **9997** (MediaMTX API) closed to the public internet — it is reached through a Cloudflare Tunnel (step 5).
3. **DNS:** add an A record `ingest.atletanotifications.com` → the VM's public IPv4. **Cloudflare proxy must be off** (gray cloud, "DNS only") — Cloudflare doesn't proxy raw RTMP.

## 2. Install MediaMTX + ffmpeg

SSH in and install dependencies:

```bash
ssh ubuntu@<vm-ip>
sudo apt update && sudo apt install -y ffmpeg curl
```

Install MediaMTX **1.20 or newer** (the hook names below, `runOnAvailable` / `runOnUnavailable`, are from 1.20; this guide was checked against 1.21.2 — see the [releases](https://github.com/bluenviron/mediamtx/releases)):

```bash
ARCH=arm64       # use amd64 if you provisioned an x86 box
VER=1.21.2
curl -fL "https://github.com/bluenviron/mediamtx/releases/download/v${VER}/mediamtx_v${VER}_linux_${ARCH}.tar.gz" \
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

Save them somewhere — you'll need both. `API_PASS` becomes `MEDIAMTX_API_TOKEN`, `HOOK_SECRET` becomes `MEDIAMTX_WEBHOOK_SECRET` (step 6).

The relay does not decide who may stream: before every publish, every read and every control-API login it asks the website (`POST /api/multistream/auth`, MediaMTX's `authMethod: http`), and the website answers:

- **publish** — only to `live/<stream key>`, with the key of an enabled account that has multistream switched on;
- **read** — only from the relay itself (its forwarders read the stream from localhost);
- **api** — only with the API login (`admin` / `API_PASS`, or the user in `MEDIAMTX_API_USER`);
- anything else is refused.

The relay proves it is the relay with `HOOK_SECRET`, sent as the password in the address it calls (and as a Bearer token on the webhooks).

Create `/etc/mediamtx/mediamtx.yml`:

```yaml
logLevel: info
logDestinations: [stdout]

# Every publish, read and control-API login is checked by the website.
authMethod: http
authHTTPAddress: 'https://mediamtx:REPLACE_WITH_HOOK_SECRET@atletanotifications.com/api/multistream/auth'
# Nothing skips the check: the control API needs the API login too.
authHTTPExclude: []

# RTMP ingest from streamers' OBS
rtmp: yes
rtmpAddress: :1935

# Not used
rtsp: no
hls: no
webrtc: no
srt: no
moq: no

# HTTP control API — localhost only, reached through the Cloudflare Tunnel
api: yes
apiAddress: 127.0.0.1:9997

paths:
  # OBS publishes to live/<stream key>. When a stream arrives or leaves, the
  # website is told; curl tries again for about half a minute if the website is
  # restarting (a deploy), and the website also checks the relay every minute.
  '~^live/[A-Za-z0-9_-]{16,128}$':
    source: publisher
    runOnAvailable: 'curl -fsS --retry 5 --retry-all-errors --max-time 10 -X POST -H "Authorization: Bearer REPLACE_WITH_HOOK_SECRET" -H "Content-Type: application/json" -d ''{"path":"$MTX_PATH"}'' https://atletanotifications.com/api/multistream/webhook/on-ready'
    runOnUnavailable: 'curl -fsS --retry 5 --retry-all-errors --max-time 10 -X POST -H "Authorization: Bearer REPLACE_WITH_HOOK_SECRET" -H "Content-Type: application/json" -d ''{"path":"$MTX_PATH"}'' https://atletanotifications.com/api/multistream/webhook/on-not-ready'
```

Replace the three `REPLACE_WITH_HOOK_SECRET` with your generated value, then lock down the file:

```bash
sudo chown root:mediamtx /etc/mediamtx/mediamtx.yml
sudo chmod 640 /etc/mediamtx/mediamtx.yml
```

Notes:

- The forwarders (`fwd_<stream key>_twitch`, `fwd_<stream key>_youtube`) are not in this file: the website adds them through the API when a stream arrives (each runs `ffmpeg -c copy` from `rtmp://localhost/live/<stream key>`) and removes them a minute after it leaves. They are lost when MediaMTX restarts; OBS reconnecting sets them up again.
- Because reads from the VM itself are allowed, never put another MediaMTX port (RTMP, HLS, WebRTC…) behind the Cloudflare Tunnel: everything that arrives through the tunnel comes from localhost.
- While the website is restarting it cannot answer the relay, so a stream that starts in those seconds is refused; OBS tries again by itself.

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

**Recommended: put Cloudflare Access in front of the relay hostname.** The API holds every live streamer's Twitch and YouTube stream keys (in the forwarders' commands). The API login already protects it; Access adds a second lock that only the website holds:

1. **Zero Trust → Access → Service Auth → Service Tokens → Create Service Token** (name it `atleta-website`). Copy the Client ID and Client Secret.
2. **Zero Trust → Access → Applications → Add an application → Self-hosted**, domain `relay.atletanotifications.com`, with a policy whose action is **Service Auth** and whose rule is that service token.
3. Set the two values on Railway (step 6) as `MEDIAMTX_CF_ACCESS_CLIENT_ID` and `MEDIAMTX_CF_ACCESS_CLIENT_SECRET`; the website then sends them with every API request.

## 6. Set the Railway env vars

In Railway → your project → Variables:

```
MEDIAMTX_API_URL=https://relay.atletanotifications.com
MEDIAMTX_INGEST_URL=rtmp://ingest.atletanotifications.com/live
MEDIAMTX_API_TOKEN=<the API_PASS from step 3>
MEDIAMTX_WEBHOOK_SECRET=<the HOOK_SECRET from step 3>
# Optional
MEDIAMTX_API_USER=admin                       # the API login's user (admin when unset)
MEDIAMTX_CF_ACCESS_CLIENT_ID=<from step 5>     # only with Cloudflare Access
MEDIAMTX_CF_ACCESS_CLIENT_SECRET=<from step 5>
```

All four of the first block are needed: with any of them missing, multistream stays switched off. **Setting them switches the feature on for every streamer** (the dashboard card appears), so do it when the relay is up, and run step 8 right after. `MULTISTREAM_KEY_SECRET` is no longer used; remove it if it is set.

Railway redeploys on the variable change. Then check the API through the tunnel (the relay asks the website about the login, so this only works once the variables are set):

```bash
curl -u admin:<API_PASS> https://relay.atletanotifications.com/v3/paths/list
# with Cloudflare Access, add:
#   -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>"
# Expected: {"itemCount":0,"pageCount":0,"items":[]}  (401 means the login or HOOK_SECRET does not match)
```

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
3. Within ~10 seconds you should be live on Twitch. The YouTube broadcast starts by itself once YouTube receives the stream (usually 10–30 s more). The dashboard page shows "You're live".
4. Stop streaming → a minute later the forwarders are removed and the YouTube broadcast is completed (it appears in Studio under "Past broadcasts"). Starting again within that minute continues the same broadcast.
5. Try a wrong stream key in OBS: the relay must refuse it.

If something fails, check both sides:
- **Relay logs:** `sudo journalctl -u mediamtx -f` on the VM (a refused login shows as "authentication failed")
- **Express logs:** `railway logs --tail` — look for `[multistream]` and `[multistream on-ready]` lines. A go-live that reached only some platforms is also shown to the streamer on the page.

## 9. Egress monitoring

Until automated cap enforcement is built, eyeball Oracle Cloud's "Networking → Bandwidth" dashboard once a week. With 1–4 streamers you're nowhere near 10 TB. If you scale up and approach the cap before month end, switch the feature off by **unsetting `MEDIAMTX_API_URL`** on Railway: the card and page disappear and the relay is refused every new publish. Streams already live keep their forwarders until MediaMTX restarts; `sudo systemctl restart mediamtx` stops them at once.

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
       │  one RTMP push (1080p60 @ ~6 Mbps) to live/<stream key>
       ▼
[ingest.atletanotifications.com:1935]   ◄── DNS A → Oracle VM public IP
       │
[MediaMTX on Oracle Always-Free VM]
       │  (0) POST /api/multistream/auth  (action publish, path live/<key>)
       │      → 200 only for an enabled account with multistream on
       │  (1) runOnAvailable fires (curl, retried)
       ▼
[POST https://atletanotifications.com/api/multistream/webhook/on-ready]
       │  (auth: Bearer MEDIAMTX_WEBHOOK_SECRET)
       │
[Express app on Railway]  services/multistreamSessions.js, one operation at a time per key
       │  (2) lookup streamer by multistream_token (enabled accounts only)
       │  (3) Twitch Helix /streams/key  → Twitch RTMP key
       │  (4) YouTube Data API: stored liveStream; reuse the broadcast if still
       │      ready/live, else create + bind (it starts by itself: enableAutoStart)
       │  (5) MediaMTX /v3/config/paths/add/fwd_<key>_<dest> for what is missing
       │      (Basic auth MEDIAMTX_API_USER / MEDIAMTX_API_TOKEN, via the tunnel)
       ▼
[MediaMTX runs one ffmpeg -c copy per forwarder]
       │  ─→ rtmp://live.twitch.tv/app/<twitch-key>
       │  ─→ rtmp://a.rtmp.youtube.com/live2/<youtube-key>

[OBS Stop Streaming]
       │
[MediaMTX runOnUnavailable fires]
       ▼
[POST /api/multistream/webhook/on-not-ready]
       │  a minute later, unless the stream is back:
       │  (1) Remove forwarder paths (ffmpeg processes die)
       │  (2) YouTube transition→complete, clear active_broadcast_id

[Every minute, on the website]
       │  streams on the relay missing a forwarder → set up again (a lost webhook)
       │  streams of a disabled account / multistream switched off → forwarders removed
       │  forwarders whose stream is gone → stopped a minute later
```

No re-encoding anywhere. The ffmpeg `-c copy` flag means we just remux RTMP packets — same H.264/AAC bytes the streamer sent, two copies sent out.
